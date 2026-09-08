package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"tickergarden/backend/internal/readmodel"
	"time"
)

type blockedSnapshotReader struct {
	entered chan struct{}
	release chan struct{}
}

func (b *blockedSnapshotReader) Load(ctx context.Context, _ string) (readmodel.Snapshot, error) {
	b.entered <- struct{}{}
	select {
	case <-ctx.Done():
		return readmodel.Snapshot{}, ctx.Err()
	case <-b.release:
		return readmodel.Snapshot{}, errors.New("fixture stopped")
	}
}
func TestSnapshotCapacitySharedAcrossRoutes(t *testing.T) {
	b := &blockedSnapshotReader{make(chan struct{}, snapshotConcurrentRequests), make(chan struct{})}
	h := New(Options{ReadModels: b})
	var wg sync.WaitGroup
	var releaseOnce sync.Once
	defer func() { releaseOnce.Do(func() { close(b.release) }); wg.Wait() }()
	for i := 0; i < snapshotConcurrentRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/v1/markets", nil))
		}()
	}
	for i := 0; i < snapshotConcurrentRequests; i++ {
		select {
		case <-b.entered:
		case <-time.After(time.Second):
			t.Fatal("read did not start")
		}
	}
	for _, path := range []string{"/health", "/readyz", "/v1/updates", "/v1/markets", "/v1/configs", "/v1/users/0x" + strings.Repeat("2", 40) + "/positions"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 503 || w.Header().Get("Retry-After") != "5" || w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Body.String(), "snapshot capacity is temporarily exhausted") {
			t.Fatal(path, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/livez", nil))
	if w.Code != 200 {
		t.Fatal("probe blocked", w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/markets", nil))
	if w.Code != 405 {
		t.Fatal("method contract changed", w.Code)
	}
	releaseOnce.Do(func() { close(b.release) })
	wg.Wait()
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/markets", nil))
	if w.Code != 200 || w.Header().Get("Retry-After") != "" {
		t.Fatal("capacity did not recover", w.Code, w.Body.String())
	}
}
func TestSnapshotCapacityReleasesAfterPanicAndCancellation(t *testing.T) {
	gate := snapshotCapacity(1)
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
