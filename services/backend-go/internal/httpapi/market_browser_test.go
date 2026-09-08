package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/readmodel"
	"time"
)

type browserDirectoryReader struct {
	snapshot    readmodel.Snapshot
	unavailable atomic.Bool
}

func (b *browserDirectoryReader) Load(context.Context, string) (readmodel.Snapshot, error) {
	if b.unavailable.Load() {
		return readmodel.Snapshot{}, errors.New("fixture unavailable")
	}
	return b.snapshot, nil
}

// Optional, bounded local fixture for testing the complete market page against
// the real Go router. Snapshot data is synthetic, not a live deployment.
func TestMarketDirectoryBrowserFixture(t *testing.T) {
	target := os.Getenv("TG_TEST_BROWSER_URL_FILE")
	if target == "" {
		t.Skip("set TG_TEST_BROWSER_URL_FILE for the bounded browser fixture")
	}
	snapshot := identityMarketSnapshot(t)
	snapshot.Sync.ChainID = 4663
	snapshot.Sync.Revision = *snapshot.Sync.BlockNumber + ":" + *snapshot.Sync.BlockHash
	reader := &browserDirectoryReader{snapshot: snapshot}
	api := New(Options{ChainID: 4663, ReadModels: reader, AllowedOrigin: "http://127.0.0.1:4393"})
	stop := make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__fixture/stop" {
			w.WriteHeader(204)
			once.Do(func() { close(stop) })
			return
		}
		if r.URL.Path == "/__fixture/unavailable" || r.URL.Path == "/__fixture/recover" {
			reader.unavailable.Store(r.URL.Path == "/__fixture/unavailable")
			w.WriteHeader(204)
			return
		}
		api.ServeHTTP(w, r)
	}))
	defer server.Close()
	if err := os.WriteFile(target, []byte(server.URL), 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(target)
	select {
	case <-stop:
	case <-time.After(120 * time.Second):
		t.Fatal("browser fixture timed out")
	}
}
