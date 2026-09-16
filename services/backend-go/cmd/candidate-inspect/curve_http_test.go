package main

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

func curveHTTPFixture(t *testing.T, f curveObserver) (*chainrpc.Client, *atomic.Int32) {
	t.Helper()
	return stateHTTPFixture(t, f.hash, f)
}

func stateHTTPFixture(t *testing.T, hash string, f deployment.BindingObserver) (*chainrpc.Client, *atomic.Int32) {
	t.Helper()
	calls := new(atomic.Int32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var q struct {
			ID     json.RawMessage   `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		var selector struct {
			Hash      string `json:"blockHash"`
			Canonical bool   `json:"requireCanonical"`
		}
		if json.NewDecoder(r.Body).Decode(&q) != nil || len(q.Params) != 2 {
			t.Error("invalid RPC request")
			http.Error(w, "invalid", 400)
			return
		}
		if q.Method == "eth_getBlockByNumber" {
			var tag string
			if json.Unmarshal(q.Params[0], &tag) != nil {
				t.Error("invalid header tag")
				return
			}
			h, e := f.Header(r.Context(), tag)
			if e != nil {
				json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "error": map[string]any{"code": -32000, "message": "header unavailable"}})
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "result": h})
			return
		}
		if json.Unmarshal(q.Params[1], &selector) != nil || selector.Hash != hash || !selector.Canonical {
			t.Error("invalid state block selector")
			http.Error(w, "invalid", 400)
			return
		}
		var raw []byte
		var err error
		switch q.Method {
		case "eth_getCode":
			var address string
			json.Unmarshal(q.Params[0], &address)
			raw, err = f.CodeAt(r.Context(), address, selector.Hash)
		case "eth_call":
			var call struct {
				To   string `json:"to"`
				Data string `json:"data"`
			}
			json.Unmarshal(q.Params[0], &call)
			raw, err = f.CallAt(r.Context(), call.To, call.Data, selector.Hash)
		default:
			t.Error("unexpected state RPC method")
			http.Error(w, "invalid", 400)
			return
		}
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "error": map[string]any{"code": -32000, "message": "state unavailable"}})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "result": "0x" + hex.EncodeToString(raw)})
	}))
	t.Cleanup(server.Close)
	client, err := chainrpc.New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	return client, calls
}
