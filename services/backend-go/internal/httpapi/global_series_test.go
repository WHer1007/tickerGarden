package httpapi

import (
	"context"
	"net/http/httptest"
	"testing"
	"tickergarden/backend/internal/analytics"
)

type globalSeriesFixture struct {
	calls  int
	broken bool
}

func (f *globalSeriesFixture) GlobalSeries(ctx context.Context, from, to, interval uint64) (analytics.GlobalFlowSeries, error) {
	f.calls++
	out := analytics.GlobalFlowSeries{Coverage: analytics.RangeCoverage{From: from, To: to}, Interval: interval, Points: []analytics.GlobalFlowPoint{}}
	if !f.broken {
		for ts := from; ts < to; ts += interval {
			out.Points = append(out.Points, analytics.GlobalFlowPoint{Timestamp: ts, Groups: []analytics.GlobalFlowGroup{}})
		}
	}
	return out, nil
}
func TestGlobalSeriesQuery(t *testing.T) {
	f := &globalSeriesFixture{}
	h := New(Options{GlobalSeries: f})
	for _, q := range []string{"", "?interval=1m&from=61&to=120", "?interval=1m&from=60&to=120&from=60", "?interval=2m&from=60&to=120", "?interval=1m&from=60&to=120&sort=asc", "?interval=1m&from=60&to=120120"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/stats/series"+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid request reached reader")
	}
	path := "/v1/stats/series?interval=1m&from=60&to=180"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code)
	}
	f.broken = true
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 503 {
		t.Fatal("incomplete buckets accepted")
	}
	w = httptest.NewRecorder()
	New(Options{}).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}
