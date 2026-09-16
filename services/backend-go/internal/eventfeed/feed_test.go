package eventfeed

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fixture struct {
	err   bool
	calls int
}

func (f *fixture) Load(context.Context, int) (Feed, error) {
	f.calls++
	if f.err {
		return Feed{}, errors.New("private database details")
	}
	return Feed{FinanciallyVerified: true}, nil
}
func TestFeedBoundary(t *testing.T) {
	f := &fixture{}
	h := Handler(f)
	for _, url := range []string{"/events?limit=0", "/events?limit=101", "/events?limit=01"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", url, nil))
		if w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid requests reached store")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/events", nil))
	var out Feed
	if json.Unmarshal(w.Body.Bytes(), &out) != nil || w.Code != 200 || !out.DisplayOnly || out.FinanciallyVerified {
		t.Fatal("financial authority leaked")
	}
	f.err = true
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/events", nil))
	if w.Code != 503 || w.Body.String() != "{\"error\":\"event_feed_unavailable\"}\n" {
		t.Fatal("unsafe error")
	}
}
