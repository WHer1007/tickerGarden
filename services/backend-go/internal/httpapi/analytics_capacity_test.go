package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"tickergarden/backend/internal/analytics"
	"time"
)

type blockedGlobalReader struct {
	entered chan struct{}
	release chan struct{}
}

func (b *blockedGlobalReader) GlobalHolders(ctx context.Context) (analytics.GlobalHolderCounts, error) {
	b.entered <- struct{}{}
	select {
	case <-ctx.Done():
		return analytics.GlobalHolderCounts{}, ctx.Err()
	case <-b.release:
		return analytics.GlobalHolderCounts{}, errors.New("fixture stopped")
	}
}
func TestAnalyticsCapacitySharedAcrossRoutes(t *testing.T) {
	b := &blockedGlobalReader{make(chan struct{}, 4), make(chan struct{})}
	h := New(Options{GlobalHolders: b})
	var wg sync.WaitGroup
	defer func() { close(b.release); wg.Wait() }()
	for i := 0; i < analyticsConcurrentRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/v1/stats/holders", nil))
		}()
	}
	for i := 0; i < analyticsConcurrentRequests; i++ {
		select {
		case <-b.entered:
		case <-time.After(time.Second):
			t.Fatal("read did not start")
		}
	}
	for _, path := range []string{"/v1/users/0x" + strings.Repeat("2", 40) + "/activity", "/v1/stats/overview", "/v1/stats/holders", "/v1/stats/series", "/v1/markets/" + "0x" + strings.Repeat("1", 64) + "/trades", "/v1/markets/" + "0x" + strings.Repeat("1", 64) + "/holders", "/v1/markets/" + "0x" + strings.Repeat("1", 64) + "/candles", "/v1/assets/" + "0x" + strings.Repeat("1", 64) + "/statistics"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 503 || w.Header().Get("Retry-After") != "5" || w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Body.String(), "analytics capacity is temporarily exhausted") {
			t.Fatal(path, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/livez", nil))
	if w.Code != 200 {
		t.Fatal("probe blocked", w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/stats/holders", nil))
	if w.Code != 405 {
		t.Fatal("method contract changed", w.Code)
	}
}
func TestAnalyticsCapacityReleasesAfterPanicAndCancellation(t *testing.T) {
	gate := analyticsCapacity(1)
	func() {
		defer func() {
			if recover() == nil {
				t.Error("expected panic")
			}
		}()
		gate(func(http.ResponseWriter, *http.Request) { panic("fixture") })(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	}()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	gate(func(w http.ResponseWriter, r *http.Request) {
		if r.Context().Err() == nil {
			t.Error("cancellation lost")
		}
	})(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil).WithContext(ctx))
	w := httptest.NewRecorder()
	gate(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 204 {
		t.Fatal("slot leaked", w.Code)
	}
}
