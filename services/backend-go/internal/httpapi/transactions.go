package httpapi

import (
	"context"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"net/http"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/transactions"
	"time"
)

type TransactionReader interface {
	Load(context.Context, string) (transactions.CombinedStatus, error)
}

func transactionReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		hash := chi.URLParam(r, "txHash")
		if !assetPattern.MatchString(hash) || r.URL.RawQuery != "" {
			writeError(w, r, 400, "invalid_query", "canonical transaction hash required; no query parameters accepted")
			return
		}
		unavailable := func() {
			writeError(w, r, 503, "transaction_unavailable", "transaction observations are unavailable or inconsistent")
		}
		if opts.Transactions == nil {
			unavailable()
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		result, err := opts.Transactions.Load(ctx, hash)
		if err != nil || ctx.Err() != nil || result.ChainID != opts.ChainID || result.TransactionHash != hash {
			unavailable()
			return
		}
		response := struct {
			transactions.CombinedStatus
			DisplayOnly bool `json:"displayOnly"`
		}{result, true}
		raw, err := json.Marshal(response)
		if err != nil || readmodel.ValidateResponse("TransactionStatusResponse", raw) != nil {
			unavailable()
			return
		}
		writeJSON(w, 200, response)
	}
}
