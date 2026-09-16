package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
	"time"
)

func TestCandidateRouteHTTP(t *testing.T) {
	for _, phase := range []string{"curve", "pool"} {
		for _, alter := range []bool{false, true} {
			t.Run(fmt.Sprint(phase, alter), func(t *testing.T) {
				data, e := os.ReadFile("testdata/routes/" + phase + ".json")
				if e != nil {
					t.Fatal(e)
				}
				var fixture struct {
					Manifest     deployment.Manifest         `json:"manifest"`
					Block        chainrpc.Header             `json:"block"`
					MarketID     string                      `json:"marketId"`
					State        map[string]any              `json:"state"`
					Observations deployment.ObservationBatch `json:"observations"`
					Calls        map[string][]byte           `json:"calls"`
					Codes        map[string][]byte           `json:"codes"`
				}
				if e = json.Unmarshal(data, &fixture); e != nil {
					t.Fatal(e)
				}
				s := fixture.State
				var route, pool map[string]any
				for _, o := range fixture.Observations.Observations {
					if o.Kind == "canonicalRoute" {
						route = o.Value
					}
					if o.Kind == "poolKey" {
						pool = o.Value
					}
				}
				str := func(v map[string]any, k string) string { return v[k].(string) }
				version, _ := strconv.ParseUint(str(s, "sourceVersion"), 10, 64)
				launchPhase, _ := strconv.ParseUint(str(s, "launchPhase"), 10, 64)
				m := readmodel.MarketReadModel{MarketID: fixture.MarketID, MemeToken: str(s, "memeToken"), QuoteAsset: str(s, "quoteAsset"), Curve: str(s, "curve"), Gauge: str(s, "gauge"), SourceVersion: version, LaunchPhase: launchPhase, CanonicalRoute: readmodel.CanonicalRoute{Router: str(route, "swapRouter"), Quoter: str(route, "quoter"), Hook: str(route, "hook"), LaunchLocker: str(route, "launchLocker"), GraduationExecutor: str(route, "graduationExecutor"), SourceVersion: version, LaunchPhase: launchPhase, CurveTradingEnabled: route["curveTradingEnabled"].(bool), PoolTradingEnabled: route["poolTradingEnabled"].(bool)}}
				if phase == "pool" {
					id := str(route, "poolId")
					m.PoolID = &id
					tick, _ := strconv.ParseInt(str(pool, "tickSpacing"), 10, 64)
					fee, _ := strconv.ParseUint(str(pool, "fee"), 10, 64)
					m.PoolKey = &readmodel.PoolKeyReadModel{Currency0: str(pool, "currency0"), Currency1: str(pool, "currency1"), Hooks: str(pool, "hooks"), Fee: fee, TickSpacing: tick}
				}
				if alter {
					m.CanonicalRoute.Router = m.MemeToken
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
				c := readmodel.CandidateSet{ChainID: fixture.Manifest.ChainID, BlockHash: fixture.Block.Hash, BlockNumber: "1", Markets: []readmodel.MarketReadModel{m}}
				if e := verifyCandidateRoutes(ctx, rpc, fixture.Manifest, c); (e == nil) == alter {
					t.Fatal(alter, e)
				}
			})
		}
	}
}
