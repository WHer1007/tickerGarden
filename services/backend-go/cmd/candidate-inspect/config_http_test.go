package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
	"time"
)

func TestCandidateConfigsHTTP(t *testing.T) {
	for _, mode := range []string{"valid", "quote amount", "baseline hash", "template hash"} {
		t.Run(mode, func(t *testing.T) {
			data, e := os.ReadFile("testdata/configs/configs.json")
			if e != nil {
				t.Fatal(e)
			}
			var fixture struct {
				Manifest     deployment.Manifest         `json:"manifest"`
				Block        chainrpc.Header             `json:"block"`
				Observations deployment.ObservationBatch `json:"observations"`
				Calls        map[string][]byte           `json:"calls"`
				Codes        map[string][]byte           `json:"codes"`
			}
			if e = json.Unmarshal(data, &fixture); e != nil {
				t.Fatal(e)
			}
			c := readmodel.CandidateSet{ChainID: fixture.Manifest.ChainID, BlockHash: fixture.Block.Hash, BlockNumber: "1"}
			source := readmodel.SourceBlock{ChainID: c.ChainID, BlockHash: c.BlockHash, BlockNumber: "1", TransactionHash: c.BlockHash}
			for _, o := range fixture.Observations.Observations {
				config, e := readmodel.BuildConfigCandidate(fixture.Observations, o.Kind, o.Key, source)
				if e != nil {
					t.Fatal(e)
				}
				if mode == "quote amount" && config.Kind == "quote" {
					config.Values["phantomQuote"] = "257"
				}
				if mode == "baseline hash" && config.Kind == "baseline" {
					config.Values["referenceFactoryCodeHash"] = c.BlockHash
				}
				if mode == "template hash" && config.Kind == "template" {
					config.Values["templateHash"] = c.BlockHash
				}
				c.Configs = append(c.Configs, config)
			}
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
				switch q.Method {
				case "eth_chainId":
					result = fmt.Sprintf("0x%x", fixture.Manifest.ChainID)
				case "eth_getBlockByNumber":
					var tag string
					json.Unmarshal(q.Params[0], &tag)
					h := fixture.Block
					h.Timestamp = "0x1"
					h.ParentHash = fixture.Manifest.GenesisHash
					if tag == "0x0" {
						h.Number = "0x0"
						h.Hash = fixture.Manifest.GenesisHash
					}
					result = h
				case "eth_getCode", "eth_call":
					var selector struct {
						Hash      string `json:"blockHash"`
						Canonical bool   `json:"requireCanonical"`
					}
					if len(q.Params) != 2 || json.Unmarshal(q.Params[1], &selector) != nil || selector.Hash != fixture.Block.Hash || !selector.Canonical {
						t.Error("unscoped state read")
						http.Error(w, "invalid", 400)
						return
					}
					var raw []byte
					var ok bool
					if q.Method == "eth_getCode" {
						var address string
						json.Unmarshal(q.Params[0], &address)
						raw, ok = fixture.Codes[address]
					} else {
						var call struct {
							To   string `json:"to"`
							Data string `json:"data"`
						}
						json.Unmarshal(q.Params[0], &call)
						raw, ok = fixture.Calls[call.To+call.Data]
					}
					if !ok {
						t.Error("unexpected state read")
						http.Error(w, "missing", 400)
						return
					}
					result = "0x" + hex.EncodeToString(raw)
				default:
					t.Error("unexpected RPC method")
					http.Error(w, "invalid", 400)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "result": result})
			}))
			defer server.Close()
			rpc, e := chainrpc.New(server.URL)
			if e != nil {
				t.Fatal(e)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if e := verifyCandidateConfigs(ctx, rpc, fixture.Manifest, c); (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}
