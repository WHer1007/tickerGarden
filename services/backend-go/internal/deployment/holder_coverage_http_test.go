package deployment

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

// Use the production transport, including its EIP-1898 native balance path.
func holderCoverageHTTPFixture(t *testing.T, f *feeFixture, block chainrpc.Header, fault string) (*chainrpc.Client, *atomic.Int32) {
	t.Helper()
	reads := new(atomic.Int32)
	headers := new(atomic.Int32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var q struct {
			ID     json.RawMessage   `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&q) != nil {
			http.Error(w, "invalid", 400)
			return
		}
		var result any
		var err error
		switch q.Method {
		case "eth_chainId":
			result = fmt.Sprintf("0x%x", f.manifest.ChainID)
		case "eth_getBlockByNumber":
			var tag string
			if len(q.Params) != 2 || json.Unmarshal(q.Params[0], &tag) != nil {
				t.Error("invalid header request")
				http.Error(w, "invalid", 400)
				return
			}
			h := block
			h.ParentHash = f.manifest.GenesisHash
			if tag == "0x0" {
				h.Number = "0x0"
				h.Hash = f.manifest.GenesisHash
			} else if tag != block.Number {
				t.Error("unexpected block", tag)
			}
			if tag == block.Number && headers.Add(1) > 1 && fault == "reorg" {
				h.Hash = zero32
			}
			result = h
		case "eth_getCode", "eth_call", "eth_getBalance":
			reads.Add(1)
			var selector struct {
				Hash      string `json:"blockHash"`
				Canonical bool   `json:"requireCanonical"`
			}
			if len(q.Params) != 2 || json.Unmarshal(q.Params[1], &selector) != nil || selector.Hash != block.Hash || !selector.Canonical {
				t.Error("unpinned Holder state read")
				http.Error(w, "invalid", 400)
				return
			}
			var address string
			if q.Method == "eth_call" {
				var call struct {
					To   string `json:"to"`
					Data string `json:"data"`
				}
				if json.Unmarshal(q.Params[0], &call) != nil {
					t.Error("invalid call")
					return
				}
				raw, ok := f.calls[call.To+call.Data]
				if !ok {
					err = fmt.Errorf("missing call")
				}
				result = "0x" + hex.EncodeToString(raw)
			} else {
				if json.Unmarshal(q.Params[0], &address) != nil {
					t.Error("invalid address")
					return
				}
				if q.Method == "eth_getCode" {
					raw, e := f.CodeAt(context.Background(), address, block.Hash)
					err = e
					result = "0x" + hex.EncodeToString(raw)
				} else {
					raw, ok := f.balances[address]
					n, parsed := new(big.Int).SetString(raw, 10)
					if !ok || !parsed {
						err = fmt.Errorf("missing balance")
					} else {
						result = "0x" + n.Text(16)
					}
					if fault == "bad native quantity" {
						result = "0x03"
					}
				}
			}
			if fault == "RPC unavailable" {
				err = fmt.Errorf("unavailable")
			}
		default:
			t.Error("unexpected RPC", q.Method)
			http.Error(w, "invalid", 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "error": map[string]any{"code": -32000, "message": "fixture unavailable"}})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "result": result})
	}))
	t.Cleanup(server.Close)
	client, e := chainrpc.New(server.URL)
	if e != nil {
		t.Fatal(e)
	}
	return client, reads
}
