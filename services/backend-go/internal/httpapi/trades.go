package httpapi

import (
	"context"
	"errors"
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"tickergarden/backend/internal/analytics"
	"time"
)

type TradeReader interface {
	Trades(context.Context, string, uint64, uint64, int, string) (analytics.TradePage, error)
}

func tradeReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		invalid := func() {
			writeError(w, r, 400, "invalid_query", "expected marketId, from/to Unix seconds, optional limit (1-100) and cursor")
		}
		market := chi.URLParam(r, "marketId")
		q, e := url.ParseQuery(r.URL.RawQuery)
		if e != nil || !candleMarketRE.MatchString(market) {
			invalid()
			return
		}
		for k, v := range q {
			if len(v) != 1 || (k != "from" && k != "to" && k != "limit" && k != "cursor") {
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
		limit := uint64(50)
		if q.Has("limit") {
			limit, a = parse(q.Get("limit"))
			if !a {
				invalid()
				return
			}
			_, a = parse(q.Get("from"))
		}
		if !a || !b || from >= to || limit < 1 || limit > 100 || len(q.Get("cursor")) > 2048 || (q.Has("cursor") && q.Get("cursor") == "") {
			invalid()
			return
		}
		if opts.Trades == nil {
			writeError(w, r, 503, "analytics_unavailable", "trade data is unavailable")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		out, e := opts.Trades.Trades(ctx, strings.ToLower(market), from, to, int(limit), q.Get("cursor"))
		if errors.Is(e, analytics.ErrTradeCursor) {
			invalid()
			return
		}
		if errors.Is(e, analytics.ErrTradePageChanged) {
			writeError(w, r, 409, "trade_page_changed", "trade data changed; restart without cursor")
			return
		}
		if e != nil {
			writeError(w, r, 503, "analytics_unavailable", "trade data is unavailable or incomplete")
			return
		}
		writeJSON(w, 200, struct {
			ChainID     uint64 `json:"chainId"`
			DisplayOnly bool   `json:"displayOnly"`
			analytics.TradePage
		}{opts.ChainID, true, out})
	}
}
