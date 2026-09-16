package httpapi

import (
	"context"
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/url"
	"strings"
	"tickergarden/backend/internal/tokendetail"
	"time"
)

type TokenDetailReader interface {
	Detail(context.Context, string, string) (tokendetail.Report, error)
}

func tokenDetailReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		market := chi.URLParam(r, "marketId")
		q, queryErr := url.ParseQuery(r.URL.RawQuery)
		period := q.Get("period")
		if period == "" {
			period = "1D"
		}
		_, _, ok := tokendetail.Period(period)
		if queryErr != nil || !candleMarketRE.MatchString(market) || !ok || len(q) > 1 || len(q["period"]) > 1 || (len(q) == 1 && !q.Has("period")) {
			writeError(w, r, 400, "invalid_query", "expected marketId and period 1H, 12H or 1D")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if opts.TokenDetail == nil {
			writeError(w, r, 503, "analytics_unavailable", "detail analytics unavailable")
			return
		}
		data, e := opts.TokenDetail.Detail(ctx, strings.ToLower(market), period)
		if e != nil {
			writeError(w, r, 503, "analytics_unavailable", "detail analytics unavailable")
			return
		}
		writeJSON(w, 200, data)
	}
}
