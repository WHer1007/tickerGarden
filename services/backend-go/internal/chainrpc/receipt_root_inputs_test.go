package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestReceiptRootInputsBoundedOrdered(t *testing.T) {
	var mu sync.Mutex
	active, peak, arrived := 0, 0, 0
	gate := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     json.RawMessage `json:"id"`
			Params []string        `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			t.Error("request")
			return
		}
		mu.Lock()
		active++
		arrived++
		if active > peak {
			peak = active
		}
		if arrived == 8 {
			close(gate)
		}
		mu.Unlock()
		defer func() { mu.Lock(); active--; mu.Unlock() }()
		select {
		case <-gate:
		case <-r.Context().Done():
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": req.Params[0]})
	}))
	defer server.Close()
	rpc, _ := New(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	hashes := make([]string, 24)
	for i := range hashes {
		hashes[i] = strconv.Itoa(i)
	}
	raw, err := rpc.receiptRootInputs(ctx, hashes)
	if err != nil {
		t.Fatal(err)
	}
	for i := range raw {
		var value string
		if json.Unmarshal(raw[i], &value) != nil || value != hashes[i] {
			t.Fatal("receipt order changed", i)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if peak != 8 {
		t.Fatal("concurrency bound", peak)
	}
}
func TestReceiptRootInputsCancellationAndFailure(t *testing.T) {
	for _, mode := range []string{"cancel", "RPC error"} {
		t.Run(mode, func(t *testing.T) {
			release := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if mode == "cancel" {
					select {
					case <-r.Context().Done():
					case <-release:
					}
					return
				}
				var req struct {
					ID json.RawMessage `json:"id"`
				}
				json.NewDecoder(r.Body).Decode(&req)
				json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32000, "message": "missing receipt"}})
			}))
			defer server.Close()
			defer close(release)
			rpc, _ := New(server.URL)
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			raw, err := rpc.receiptRootInputs(ctx, make([]string, 24))
			if err == nil || raw != nil {
				t.Fatal("partial result escaped", err)
			}
		})
	}
}
