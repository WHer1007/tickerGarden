package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestTransactionReceiptNullMissingAndRPCError(t *testing.T) {
	cases := map[string]string{
		"null result":    `{"jsonrpc":"2.0","id":1,"result":null}`,
		"missing result": `{"jsonrpc":"2.0","id":1}`,
		"rpc error":      `{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"unavailable"}}`,
	}
	for name, response := range cases {
		t.Run(name, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(response)) })
			defer s.Close()
			got, err := c.TransactionReceipt(context.Background(), receiptTx0)
			if name == "null result" {
				if err != nil || got != nil {
					t.Fatalf("receipt = %#v, %v", got, err)
				}
			} else if err == nil || got != nil {
				t.Fatalf("expected error, receipt = %#v, %v", got, err)
			}
		})
	}
}

func TestTransactionReceiptRejectsIdentityStatusHeightAndLogs(t *testing.T) {
	cases := map[string]func(map[string]any){
		"wrong transaction hash":            func(r map[string]any) { r["transactionHash"] = receiptTx1 },
		"receipt log block hash mismatch":   func(r map[string]any) { r["blockHash"] = receiptTx1 },
		"receipt log block number mismatch": func(r map[string]any) { r["blockNumber"] = "0x2" },
		"malformed block hash":              func(r map[string]any) { r["blockHash"] = "0x12" },
		"malformed block number":            func(r map[string]any) { r["blockNumber"] = "0xzz" },
		"malformed tx index":                func(r map[string]any) { r["transactionIndex"] = "0xzz" },
		"malformed status":                  func(r map[string]any) { r["status"] = "0x2" },
		"null logs":                         func(r map[string]any) { r["logs"] = nil },
		"reverted with logs":                func(r map[string]any) { r["status"] = "0x0" },
		"malformed log index":               func(r map[string]any) { r["logs"].([]any)[0].(map[string]any)["logIndex"] = "0xzz" },
		"duplicate log index":               func(r map[string]any) { r["logs"] = append(r["logs"].([]any), receiptLog()) },
		"malformed topic":                   func(r map[string]any) { r["logs"].([]any)[0].(map[string]any)["topics"] = []string{"0x12"} },
		"removed log":                       func(r map[string]any) { r["logs"].([]any)[0].(map[string]any)["removed"] = true },
		"invalid address":                   func(r map[string]any) { r["logs"].([]any)[0].(map[string]any)["address"] = "0x12" },
		"invalid data":                      func(r map[string]any) { r["logs"].([]any)[0].(map[string]any)["data"] = "0xzz" },
		"too many topics": func(r map[string]any) {
			r["logs"].([]any)[0].(map[string]any)["topics"] = []string{testHash, testHash, testHash, testHash, testHash}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			receipt := map[string]any{"transactionHash": receiptTx0, "transactionIndex": "0x0", "blockHash": receiptBlockHash, "blockNumber": "0x1", "status": "0x1", "logs": []any{receiptLog()}}
			mutate(receipt)
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Method string   `json:"method"`
					Params []string `json:"params"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Method != "eth_getTransactionReceipt" || len(req.Params) != 1 || req.Params[0] != receiptTx0 {
					t.Errorf("request = %#v", req)
				}
				rpcReply(t, w, receipt)
			})
			defer s.Close()
			if got, err := c.TransactionReceipt(context.Background(), receiptTx0); err == nil || got != nil {
				t.Fatalf("accepted invalid receipt: %#v, %v", got, err)
			}
		})
	}
}

func TestTransactionReceiptAcceptsLogs(t *testing.T) {
	receipt := map[string]any{"transactionHash": receiptTx0, "transactionIndex": "0x0", "blockHash": receiptBlockHash, "blockNumber": "0x1", "status": "0x1", "logs": []any{receiptLog()}}
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { rpcReply(t, w, receipt) })
	defer s.Close()
	got, err := c.TransactionReceipt(context.Background(), receiptTx0)
	if err != nil || got == nil || len(got.Logs) != 1 {
		t.Fatalf("receipt = %#v, %v", got, err)
	}
}

func TestTransactionReceiptAcceptsSuccessAndRevertedEmptyLogs(t *testing.T) {
	for _, status := range []string{"0x1", "0x0"} {
		t.Run(status, func(t *testing.T) {
			receipt := map[string]any{"transactionHash": receiptTx0, "transactionIndex": "0x0", "blockHash": receiptBlockHash, "blockNumber": "0x1", "status": status, "logs": []any{}}
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { rpcReply(t, w, receipt) })
			defer s.Close()
			got, err := c.TransactionReceipt(context.Background(), receiptTx0)
			if err != nil || got == nil || got.Status != status || len(got.Logs) != 0 {
				t.Fatalf("receipt = %#v, %v", got, err)
			}
		})
	}
}
