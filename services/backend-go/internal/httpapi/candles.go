package httpapi

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"tickergarden/backend/internal/analytics"
)

type CandleReader interface {
	Candles(context.Context, string, uint64, uint64, uint64) (analytics.MarketCandles, error)
}

var candleMarketRE = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)

func candleReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		market := chi.URLParam(r, "marketId")
		q, err := url.ParseQuery(r.URL.RawQuery)
		invalid := func() {
			writeError(w, r, 400, "invalid_query", "expected marketId and aligned interval/from/to (Unix seconds), up to 2000 candles")
		}
		if err != nil || !candleMarketRE.MatchString(market) || len(q) != 3 {
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
		if opts.Candles == nil {
			writeError(w, r, 503, "analytics_unavailable", "candle data is unavailable")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		market = strings.ToLower(market)
		out, err := opts.Candles.Candles(ctx, market, from, to, interval)
		if err != nil || out.MarketID != market || out.Interval != interval || out.Coverage.From != from || out.Coverage.To != to || len(out.Series.Candles) != int((to-from)/interval) {
			writeError(w, r, 503, "analytics_unavailable", "candle data is unavailable or incomplete")
			return
		}
		writeJSON(w, 200, struct {
			ChainID     uint64 `json:"chainId"`
			DisplayOnly bool   `json:"displayOnly"`
			analytics.MarketCandles
		}{opts.ChainID, true, out})
	}
}
