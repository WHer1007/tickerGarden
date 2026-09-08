package httpapi

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"tickergarden/backend/internal/analytics"
)

type GlobalSeriesReader interface {
	GlobalSeries(context.Context, uint64, uint64, uint64) (analytics.GlobalFlowSeries, error)
}

func globalSeriesReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		q, err := url.ParseQuery(r.URL.RawQuery)
		invalid := func() {
			writeError(w, r, 400, "invalid_query", "expected aligned interval/from/to (Unix seconds), up to 2000 time buckets")
		}
		if err != nil || len(q) != 3 {
			invalid()
			return
		}
		for key, v := range q {
			if (key != "interval" && key != "from" && key != "to") || len(v) != 1 {
				invalid()
				return
			}
		}
		interval := map[string]uint64{"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}[q.Get("interval")]
		parse := func(s string) (uint64, bool) {
			n, e := strconv.ParseUint(s, 10, 63)
			return n, e == nil && strconv.FormatUint(n, 10) == s
		}
		from, ok := parse(q.Get("from"))
		to, okTo := parse(q.Get("to"))
		if !ok || !okTo || interval == 0 || to > math.MaxInt64 || from >= to || from%interval != 0 || to%interval != 0 || (to-from)/interval > 2000 {
			invalid()
			return
		}
		if opts.GlobalSeries == nil {
			writeError(w, r, 503, "analytics_unavailable", "time series data is unavailable")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		out, err := opts.GlobalSeries.GlobalSeries(ctx, from, to, interval)
		if err != nil || out.Interval != interval || out.Coverage.From != from || out.Coverage.To != to || len(out.Points) != int((to-from)/interval) {
			writeError(w, r, 503, "analytics_unavailable", "time series data is unavailable or incomplete")
			return
		}
		writeJSON(w, 200, struct {
			ChainID     uint64 `json:"chainId"`
			DisplayOnly bool   `json:"displayOnly"`
			analytics.GlobalFlowSeries
		}{opts.ChainID, true, out})
	}
}
