package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/analytics"
)

type candleFixtureReader struct {
	calls int
	fail  bool
}

func (f *candleFixtureReader) Candles(ctx context.Context, m string, from, to, interval uint64) (analytics.MarketCandles, error) {
	f.calls++
	if _, ok := ctx.Deadline(); !ok {
		panic("missing deadline")
	}
	if f.fail {
		return analytics.MarketCandles{}, errors.New("private database error")
	}
	return analytics.MarketCandles{MarketID: m, Interval: interval, Coverage: analytics.RangeCoverage{From: from, To: to}, Series: analytics.CandleSeries{Candles: []analytics.Candle{{Timestamp: from}}}}, nil
}
func TestCandleHTTP(t *testing.T) {
	path := "/v1/markets/0x" + strings.Repeat("a", 64) + "/candles"
	f := &candleFixtureReader{}
	h := New(Options{ChainID: 4663, Candles: f})
	for _, tc := range []struct {
		method, query string
		status        int
	}{
		{"GET", "?interval=1m&from=60&to=120", 200},
		{"POST", "?interval=1m&from=60&to=120", 405},
		{"GET", "", 400}, {"GET", "?interval=1m&from=060&to=120", 400},
		{"GET", "?interval=1m&from=61&to=120", 400}, {"GET", "?interval=2m&from=60&to=120", 400},
		{"GET", "?interval=1m&from=60&from=120&to=180", 400}, {"GET", "?interval=1m&from=60&to=120&revision=x", 400},
		{"GET", "?interval=1m&from=60&to=120120", 400}, {"GET", "?interval=1m&from=120&to=60", 400},
		{"GET", "?interval=1m&from=%GG&to=120", 400},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, path+tc.query, nil))
		if w.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.query, w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("cache enabled")
		}
	}
	if f.calls != 1 {
		t.Fatal("bad queries reached store", f.calls)
	}
	f.fail = true
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path+"?interval=1m&from=60&to=120", nil))
	if w.Code != 503 || strings.Contains(w.Body.String(), "private") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	New(Options{ChainID: 4663}).ServeHTTP(w, httptest.NewRequest("GET", path+"?interval=1m&from=60&to=120", nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}
