package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"testing"

	"tickergarden/backend/internal/readmodel"
)

// Exercise updates and pinned pagination through one real HTTP server. The
// snapshot reader is controlled here; database publication is a separate gate.
func TestUpdatePagingRecoveryHTTP(t *testing.T) {
	old := marketQuerySnapshot(t)
	newer := marketQuerySnapshot(t)
	number, hash := "8", "0x"+strings.Repeat("e", 64)
	newer.Sync.BlockNumber = &number
	newer.Sync.BlockHash = &hash
	newer.Sync.Revision = number + ":" + hash
	newer.Markets = append([]readmodel.MarketReadModel{}, newer.Markets[1:]...)
	newer.Configs = nil
	newer.Positions = nil
	// Give the old fixture a coherent revision identity too.
	oldNumber, oldHash := "7", "0x"+strings.Repeat("c", 64)
	old.Sync.BlockNumber = &oldNumber
	old.Sync.BlockHash = &oldHash
	var mu sync.RWMutex
	latest := old
	expired, unavailable := false, false
	server := httptest.NewServer(New(Options{ChainID: 46630, ReadModels: readerFunc(func(_ context.Context, revision string) (readmodel.Snapshot, error) {
		mu.RLock()
		defer mu.RUnlock()
		if unavailable {
			return readmodel.Empty(46630), nil
		}
		if revision == old.Sync.Revision && !expired {
			return old, nil
		}
		if revision == "" || revision == latest.Sync.Revision {
			return latest, nil
		}
		return readmodel.Empty(46630), readmodel.ErrRevision
	})}))
	defer server.Close()
	get := func(path string, code int, out any) {
		t.Helper()
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != code {
			t.Fatalf("%s: status %d", path, response.StatusCode)
		}
		if response.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("cached response")
		}
		if out != nil {
			if err = json.NewDecoder(response.Body).Decode(out); err != nil {
				t.Fatal(err)
			}
		}
	}
	var first page[readmodel.MarketReadModel]
	get("/v1/markets?limit=100&revision="+url.QueryEscape(old.Sync.Revision), 200, &first)
	if len(first.Items) != 100 || first.NextCursor == nil {
		t.Fatal("missing first page")
	}
	mu.Lock()
	latest = newer
	mu.Unlock()
	var updates struct {
		Mode        string
		Invalidated []string
		Sync        readmodel.SyncStatus
	}
	get("/v1/updates?since="+url.QueryEscape(old.Sync.Revision), 200, &updates)
	if updates.Mode != "changed" || updates.Sync.Revision != newer.Sync.Revision || !reflect.DeepEqual(updates.Invalidated, []string{"markets", "configs", "positions"}) {
		t.Fatalf("missing deletion invalidations: %+v", updates)
	}
	cursor := url.QueryEscape(*first.NextCursor)
	get("/v1/markets?limit=100&revision="+url.QueryEscape(newer.Sync.Revision)+"&cursor="+cursor, 400, nil)
	var second page[readmodel.MarketReadModel]
	get("/v1/markets?limit=100&revision="+url.QueryEscape(old.Sync.Revision)+"&cursor="+cursor, 200, &second)
	if len(second.Items) != 30 || second.Sync.Revision != old.Sync.Revision {
		t.Fatal("mixed pagination")
	}
	mu.Lock()
	expired = true
	mu.Unlock()
	get("/v1/updates?since="+url.QueryEscape(old.Sync.Revision), 200, &updates)
	if updates.Mode != "reset" || len(updates.Invalidated) != 4 {
		t.Fatal("expired history not reset")
	}
	get("/v1/markets?limit=100&revision="+url.QueryEscape(old.Sync.Revision)+"&cursor="+cursor, 400, nil)
	var replacement page[readmodel.MarketReadModel]
	get("/v1/markets?limit=100&revision="+url.QueryEscape(newer.Sync.Revision), 200, &replacement)
	for _, market := range replacement.Items {
		if market.MarketID == old.Markets[0].MarketID {
			t.Fatal("deleted market survived reset")
		}
	}
	mu.Lock()
	unavailable = true
	mu.Unlock()
	get("/v1/updates?since="+url.QueryEscape(newer.Sync.Revision), 503, nil)
	mu.Lock()
	unavailable = false
	mu.Unlock()
	get("/v1/updates?since="+url.QueryEscape(newer.Sync.Revision), 200, &updates)
	if updates.Mode != "unchanged" || len(updates.Invalidated) != 0 {
		t.Fatal("same revision recovery incorrect")
	}
}
