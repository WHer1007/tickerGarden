package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

func candidateRPCFixture(t *testing.T, chain uint64, genesis, block, address string, responses map[string]string, codes map[string]bool) (*httptest.Server, *atomic.Int32, *atomic.Int32) {
	t.Helper()
	mode, calls := new(atomic.Int32), new(atomic.Int32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request struct {
			ID     json.RawMessage   `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		var result any
		switch request.Method {
		case "eth_chainId":
			result = fmt.Sprintf("0x%x", chain)
		case "eth_getBlockByNumber":
			var tag string
			if len(request.Params) != 2 || json.Unmarshal(request.Params[0], &tag) != nil {
				t.Error("invalid header request")
				http.Error(w, "invalid", 400)
				return
			}
			h := chainrpc.Header{Number: "0x1", Hash: block, ParentHash: genesis, Timestamp: "0x64"}
			if tag == "0x0" {
				h.Number = "0x0"
				h.Hash = genesis
				h.Timestamp = "0x0"
			}
			result = h
		case "eth_getCode":
			var target string
			var selector struct {
				Hash      string `json:"blockHash"`
				Canonical bool   `json:"requireCanonical"`
			}
			if len(request.Params) != 2 || json.Unmarshal(request.Params[0], &target) != nil || json.Unmarshal(request.Params[1], &selector) != nil || !codes[target] || selector.Hash != block || !selector.Canonical {
				t.Error("unscoped code request")
				http.Error(w, "invalid", 400)
				return
			}
			result = "0x01"
			if mode.Load() == 1 {
				result = "0x02"
			}
			if mode.Load() == 2 {
				json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "error": map[string]any{"code": -32000, "message": "historical state unavailable"}})
				return
			}

		case "eth_call":
			var target struct {
				To   string `json:"to"`
				Data string `json:"data"`
			}
			var selector struct {
				Hash      string `json:"blockHash"`
				Canonical bool   `json:"requireCanonical"`
			}
			if len(request.Params) != 2 || json.Unmarshal(request.Params[0], &target) != nil || json.Unmarshal(request.Params[1], &selector) != nil || selector.Hash != block || !selector.Canonical {
				t.Error("unscoped call")
				http.Error(w, "invalid", 400)
				return
			}
			value, ok := responses[target.To+":"+target.Data]
			if !ok {
				t.Errorf("unexpected call %s %s", target.To, target.Data)
				http.Error(w, "unknown", 400)
				return
			}
			if mode.Load() == 3 && strings.HasPrefix(target.Data, deployment.Hash([]byte("assetIdentityCurrent(bytes32)"))[:10]) {
				value = fmt.Sprintf("0x%064x", 0)
			}
			if mode.Load() == 4 && strings.HasPrefix(target.Data, deployment.Hash([]byte("minimumAllocation(bytes32)"))[:10]) {
				value = fmt.Sprintf("0x%064x", 415)
			}
			if mode.Load() == 5 && strings.HasPrefix(target.Data, deployment.Hash([]byte("totalDeposited(bytes32)"))[:10]) {
				value = fmt.Sprintf("0x%064x", 1)
			}
			result = value
		default:
			t.Errorf("unexpected RPC method %s", request.Method)
			http.Error(w, "unsupported", 400)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
	}))
	t.Cleanup(server.Close)
	return server, mode, calls
}
