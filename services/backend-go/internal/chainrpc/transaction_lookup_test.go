package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func lookupFixture() map[string]any {
	return map[string]any{"hash": receiptTx0, "from": "0x" + strings.Repeat("1", 40), "to": "0x" + strings.Repeat("2", 40), "nonce": "0x1", "blockHash": nil, "blockNumber": nil, "transactionIndex": nil}
}
func TestTransactionLookupPendingIncludedAndCreation(t *testing.T) {
	for _, mode := range []string{"pending", "included", "creation"} {
		t.Run(mode, func(t *testing.T) {
			fixture := lookupFixture()
			if mode == "included" {
				fixture["blockHash"] = receiptBlockHash
				fixture["blockNumber"] = "0x2"
				fixture["transactionIndex"] = "0x0"
			}
			if mode == "creation" {
				fixture["to"] = nil
			}
			server, client := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Method string   `json:"method"`
					Params []string `json:"params"`
				}
				if json.NewDecoder(r.Body).Decode(&req) != nil || req.Method != "eth_getTransactionByHash" || len(req.Params) != 1 || req.Params[0] != receiptTx0 {
					t.Error("invalid lookup request")
				}
				rpcReply(t, w, fixture)
			})
			defer server.Close()
			got, err := client.TransactionByHash(context.Background(), receiptTx0)
			if err != nil || got == nil || got.Pending() != (mode != "included") || (mode == "creation" && got.To != nil) {
				t.Fatal(got, err)
			}
		})
	}
}
func TestTransactionLookupDoesNotInferPendingFromMissingFields(t *testing.T) {
	cases := map[string]func(map[string]any){
		"hash": func(v map[string]any) { v["hash"] = receiptTx1 }, "from": func(v map[string]any) { v["from"] = "bad" }, "to": func(v map[string]any) { v["to"] = "bad" }, "nonce": func(v map[string]any) { v["nonce"] = "0x01" },
		"missing block": func(v map[string]any) { delete(v, "blockHash") }, "missing number": func(v map[string]any) { delete(v, "blockNumber") }, "missing index": func(v map[string]any) { delete(v, "transactionIndex") }, "missing to": func(v map[string]any) { delete(v, "to") },
		"partial number": func(v map[string]any) { v["blockNumber"] = "0x1" }, "partial index": func(v map[string]any) { v["transactionIndex"] = "0x0" }, "partial hash": func(v map[string]any) { v["blockHash"] = receiptBlockHash }, "numeric nonce": func(v map[string]any) { v["nonce"] = 1 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			fixture := lookupFixture()
			mutate(fixture)
			server, client := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { rpcReply(t, w, fixture) })
			defer server.Close()
			got, err := client.TransactionByHash(context.Background(), receiptTx0)
			if err == nil || got != nil {
				t.Fatal(got, err)
			}
		})
	}
}
func TestTransactionLookupNullIsDistinctFromRPCFailure(t *testing.T) {
	for _, body := range []string{`{"jsonrpc":"2.0","id":1,"result":null}`, `{"jsonrpc":"2.0","id":1}`, `{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"offline"}}`} {
		server, client := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) })
		got, err := client.TransactionByHash(context.Background(), receiptTx0)
		server.Close()
		if got != nil || (err == nil) != strings.Contains(body, `"result":null`) {
			t.Fatal(got, err)
		}
	}
}
