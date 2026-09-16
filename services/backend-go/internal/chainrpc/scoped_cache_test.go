package chainrpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func cacheHeader(number uint64, hash, parent string) Header {
	return Header{Number: fmt.Sprintf("0x%x", number), Hash: hash, ParentHash: parent, Timestamp: "0x7b"}
}

func cacheRPC(t *testing.T, fn func(string, []any) any) (*httptest.Server, *Client) {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var q struct {
			Method string `json:"method"`
			Params []any  `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&q); err != nil {
			t.Error(err)
			return
		}
		body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "result": fn(q.Method, q.Params)})
		if err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	c, err := New(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	return s, c
}

func TestCachedScopedObserverConstructionDoesNotCallRPC(t *testing.T) {
	var calls int
	s, c := cacheRPC(t, func(string, []any) any { calls++; return nil })
	defer s.Close()
	_ = NewCachedScopedObserver(c, nil)
	if calls != 0 {
		t.Fatalf("construction made %d RPC calls", calls)
	}
}

func TestCachedScopedObserverFinalizedHistoryFetchesOnce(t *testing.T) {
	finalized := cacheHeader(17, "0x"+fmt.Sprintf("%064x", 17), "0x"+fmt.Sprintf("%064x", 16))
	var mu sync.Mutex
	calls := map[string]int{}
	s, c := cacheRPC(t, func(method string, params []any) any {
		mu.Lock()
		calls[method]++
		mu.Unlock()
		if method == "eth_getBlockByNumber" {
			tag := params[0].(string)
			if tag == "finalized" {
				return finalized
			}
			n := uint64(0)
			_, _ = fmt.Sscanf(tag, "0x%x", &n)
			return cacheHeader(n, "0x"+fmt.Sprintf("%064x", n), "0x"+fmt.Sprintf("%064x", n-1))
		}
		return nil
	})
	defer s.Close()
	o := NewCachedScopedObserver(c, func(context.Context, Header) ([]string, error) {
		return []string{"0x1111111111111111111111111111111111111111"}, nil
	})
	if _, err := o.Header(context.Background(), "finalized"); err != nil {
		t.Fatal(err)
	}
	if _, err := o.Header(context.Background(), "0xf"); err != nil {
		t.Fatal(err)
	}
	if _, err := o.Header(context.Background(), "0xf"); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if calls["eth_getBlockByNumber"] != 4 {
		t.Fatalf("header calls = %d, want finalized plus three history headers", calls["eth_getBlockByNumber"])
	}
}

func TestCachedScopedObserverRevalidatesExpiredMovingAnchors(t *testing.T) {
	var latestCalls int
	s, c := cacheRPC(t, func(method string, params []any) any {
		if method == "eth_getBlockByNumber" && params[0] == "latest" {
			latestCalls++
			return cacheHeader(uint64(20+latestCalls), "0x"+fmt.Sprintf("%064x", 20+latestCalls), "0x"+fmt.Sprintf("%064x", 19+latestCalls))
		}
		return nil
	})
	defer s.Close()
	o := NewCachedScopedObserver(c, nil)
	if _, err := o.Header(context.Background(), "latest"); err != nil {
		t.Fatal(err)
	}
	o.cache.moving["latest"] = cachedScopeHeader{header: o.cache.moving["latest"].header, until: time.Now().Add(-time.Second)}
	if _, err := o.Header(context.Background(), "latest"); err != nil {
		t.Fatal(err)
	}
	if latestCalls != 2 {
		t.Fatalf("latest calls = %d, want 2", latestCalls)
	}
}

func TestCachedScopedObserverRejectsWrongParentInDemandedBatch(t *testing.T) {
	finalized := cacheHeader(17, "0x"+fmt.Sprintf("%064x", 17), "0x"+fmt.Sprintf("%064x", 16))
	s, c := cacheRPC(t, func(method string, params []any) any {
		if method != "eth_getBlockByNumber" {
			return nil
		}
		tag := params[0].(string)
		if tag == "finalized" {
			return finalized
		}
		var n uint64
		_, _ = fmt.Sscanf(tag, "0x%x", &n)
		parent := "0x" + fmt.Sprintf("%064x", n-1)
		if n == 16 {
			parent = "0x" + fmt.Sprintf("%064x", 999)
		}
		return cacheHeader(n, "0x"+fmt.Sprintf("%064x", n), parent)
	})
	defer s.Close()
	o := NewCachedScopedObserver(c, nil)
	if _, err := o.Header(context.Background(), "finalized"); err != nil {
		t.Fatal(err)
	}
	if _, err := o.Header(context.Background(), "0xf"); err == nil {
		t.Fatal("wrong parent accepted")
	}
}
