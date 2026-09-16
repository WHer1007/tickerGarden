package httpapi

import (
	"context"
	"net/http/httptest"
	"testing"
	"tickergarden/backend/internal/analytics"
)

type globalFixture struct{ calls int }

func (f *globalFixture) GlobalStatistics(ctx context.Context, from, to uint64) (analytics.GlobalStatistics, error) {
	f.calls++
	return analytics.GlobalStatistics{Coverage: analytics.RangeCoverage{From: from, To: to}, Stocks: []analytics.StockIdentity{}, Groups: []analytics.GlobalTradeGroup{}}, nil
}
func TestGlobalStatisticsHTTP(t *testing.T) {
	f := &globalFixture{}
	h := New(Options{GlobalStatistics: f, ChainID: 4663})
	for _, q := range []string{"", "?from=2&to=1", "?from=01&to=2", "?from=1&to=2&sort=asc", "?from=1&to=2&from=1"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/stats/overview"+q, nil))
		if w.Code != 400 {
			t.Fatal(w.Code, q)
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid query reached reader")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/stats/overview?from=1&to=2", nil))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	New(Options{}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/stats/overview?from=1&to=2", nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}
