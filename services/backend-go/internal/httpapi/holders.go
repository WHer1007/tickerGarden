package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"tickergarden/backend/internal/analytics"
)

type HolderReader interface {
	HolderPage(context.Context, string, int, string) (analytics.HolderPage, error)
}

func holderReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		invalid := func() { writeError(w, r, 400, "invalid_query", "expected marketId, optional limit (1-100) and cursor") }
		market := chi.URLParam(r, "marketId")
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || !candleMarketRE.MatchString(market) {
			invalid()
			return
		}
		for k, v := range q {
			if len(v) != 1 || (k != "limit" && k != "cursor") {
				invalid()
				return
			}
		}
		limit := 50
		if q.Has("limit") {
			n, e := strconv.Atoi(q.Get("limit"))
			if e != nil || strconv.Itoa(n) != q.Get("limit") || n < 1 || n > 100 {
				invalid()
				return
			}
			limit = n
		}
		cursor := q.Get("cursor")
		if len(cursor) > 2048 || (q.Has("cursor") && cursor == "") {
			invalid()
			return
		}
		unavailable := func() { writeError(w, r, 503, "analytics_unavailable", "holder history is unavailable or incomplete") }
		if opts.Holders == nil {
			unavailable()
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		market = strings.ToLower(market)
		out, err := opts.Holders.HolderPage(ctx, market, limit, cursor)
		if errors.Is(err, analytics.ErrHolderCursor) {
			invalid()
			return
		}
		if errors.Is(err, analytics.ErrHolderPageChanged) {
			writeError(w, r, 409, "holder_page_changed", "holder snapshot changed; restart without cursor")
			return
		}
		if err != nil || out.MarketID != market || out.Finality != "finalized" || len(out.Balances) > limit || out.Balances == nil {
			unavailable()
			return
		}
		writeJSON(w, 200, struct {
			ChainID     uint64 `json:"chainId"`
			DisplayOnly bool   `json:"displayOnly"`
			analytics.HolderPage
		}{opts.ChainID, true, out})
	}
}
