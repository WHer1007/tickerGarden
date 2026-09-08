package httpapi

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"tickergarden/backend/internal/analytics"
)

type AssetStatisticsReader interface {
	AssetStatistics(context.Context, string, uint64, uint64) (analytics.AssetStatistics, error)
}

func assetStatisticsReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		invalid := func() { writeError(w, r, 400, "invalid_query", "expected assetUid and from/to Unix seconds") }
		asset := chi.URLParam(r, "assetUid")
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || !candleMarketRE.MatchString(asset) {
			invalid()
			return
		}
		for k, v := range q {
			if len(v) != 1 || (k != "from" && k != "to") {
				invalid()
				return
			}
		}
		parse := func(s string) (uint64, bool) {
			n, e := strconv.ParseUint(s, 10, 63)
			return n, e == nil && strconv.FormatUint(n, 10) == s
		}
		from, a := parse(q.Get("from"))
		to, b := parse(q.Get("to"))
		if !a || !b || from >= to {
			invalid()
			return
		}
		unavailable := func() {
			writeError(w, r, 503, "analytics_unavailable", "asset statistics are unavailable or incomplete")
		}
		if opts.AssetStatistics == nil {
			unavailable()
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		asset = strings.ToLower(asset)
		out, err := opts.AssetStatistics.AssetStatistics(ctx, asset, from, to)
		if err != nil || out.AssetUID != asset || out.Coverage.From != from || out.Coverage.To != to || out.Groups == nil {
			unavailable()
			return
		}
		writeJSON(w, 200, struct {
			ChainID     uint64 `json:"chainId"`
			DisplayOnly bool   `json:"displayOnly"`
			analytics.AssetStatistics
		}{opts.ChainID, true, out})
	}
}
