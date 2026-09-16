package httpapi

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/analytics"
)

type tradeReaderFixture struct {
	err   error
	calls int
}

func (f *tradeReaderFixture) Trades(ctx context.Context, m string, from, to uint64, limit int, cursor string) (analytics.TradePage, error) {
	f.calls++
	return analytics.TradePage{Items: []analytics.TradeActivity{}}, f.err
}
func TestTradeHTTPQueryAndCursorErrors(t *testing.T) {
	f := &tradeReaderFixture{}
	h := New(Options{Trades: f})
	path := "/v1/markets/0x" + strings.Repeat("1", 64) + "/trades"
	for _, query := range []string{"", "?from=1&to=2&limit=0", "?from=1&to=2&limit=101", "?from=01&to=2&limit=10", "?from=1&to=2&cursor=", "?from=2&to=1", "?from=1&to=2&from=1", "?from=1&to=2&sort=asc"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path+query, nil))
		if w.Code != 400 {
			t.Fatal(query, w.Code)
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid request reached store")
	}
	for _, tc := range []struct {
		err  error
		code int
	}{{nil, 200}, {analytics.ErrTradeCursor, 400}, {analytics.ErrTradePageChanged, 409}, {analytics.ErrCoverage, 503}} {
		f.err = tc.err
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path+"?from=1&to=2", nil))
		if w.Code != tc.code || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(w.Code)
		}
	}
}
