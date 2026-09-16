package httpapi

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"tickergarden/backend/internal/analytics"
)

type GlobalStatisticsReader interface {
	GlobalStatistics(context.Context, uint64, uint64) (analytics.GlobalStatistics, error)
}

func globalStatisticsReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		invalid := func() { writeError(w, r, 400, "invalid_query", "expected from/to Unix seconds") }
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
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
			writeError(w, r, 503, "analytics_unavailable", "global statistics are unavailable or incomplete")
		}
		if opts.GlobalStatistics == nil {
			unavailable()
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		out, err := opts.GlobalStatistics.GlobalStatistics(ctx, from, to)
		if err != nil || out.Coverage.From != from || out.Coverage.To != to || out.Groups == nil {
			unavailable()
			return
		}
		writeJSON(w, 200, struct {
			ChainID     uint64 `json:"chainId"`
			DisplayOnly bool   `json:"displayOnly"`
			analytics.GlobalStatistics
		}{opts.ChainID, true, out})
	}
}
