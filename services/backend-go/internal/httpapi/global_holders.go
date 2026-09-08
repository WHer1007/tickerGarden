package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"tickergarden/backend/internal/analytics"
)

type GlobalHolderReader interface {
	GlobalHolders(context.Context) (analytics.GlobalHolderCounts, error)
}

func globalHolderReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		if r.URL.RawQuery != "" {
			writeError(w, r, 400, "invalid_query", "global holder statistics accept no query parameters")
			return
		}
		unavailable := func() {
			writeError(w, r, 503, "analytics_unavailable", "global holder history is unavailable or incomplete")
		}
		if opts.GlobalHolders == nil {
			unavailable()
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		out, err := opts.GlobalHolders.GlobalHolders(ctx)
		n, e := strconv.ParseUint(out.SourceBlockNumber, 10, 63)
		if err != nil || e != nil || strconv.FormatUint(n, 10) != out.SourceBlockNumber || !candleMarketRE.MatchString(out.SourceBlockHash) || out.Groups == nil || out.ExcludedAccounts == nil || out.IncludedAddressCount > out.PositiveAddressCount || out.PositiveAddressCount > out.PositiveMarketAddressPairs || out.ExclusionPolicy != "UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1" {
			unavailable()
			return
		}
		writeJSON(w, 200, struct {
			ChainID     uint64 `json:"chainId"`
			DisplayOnly bool   `json:"displayOnly"`
			Finality    string `json:"finality"`
			analytics.GlobalHolderCounts
		}{opts.ChainID, true, "finalized", out})
	}
}
