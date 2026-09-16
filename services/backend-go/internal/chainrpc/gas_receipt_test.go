package chainrpc

import (
	"context"
	"net/http"
	"testing"
)

func TestGasReceiptRequiresFeeFieldsAndValidIdentity(t *testing.T) {
	for _, mode := range []string{"valid", "zero-price", "missing", "bad-gas", "zero-gas", "bad-price", "wrong-hash", "null"} {
		t.Run(mode, func(t *testing.T) {
			r := map[string]any{"transactionHash": receiptTx0, "transactionIndex": "0x0", "blockHash": receiptBlockHash, "blockNumber": "0x1", "status": "0x1", "logs": []any{}, "gasUsed": "0x5208", "effectiveGasPrice": "0x3"}
			switch mode {
			case "zero-price":
				r["effectiveGasPrice"] = "0x0"
			case "missing":
				delete(r, "gasUsed")
			case "bad-gas":
				r["gasUsed"] = "0x05208"
			case "zero-gas":
				r["gasUsed"] = "0x0"
			case "bad-price":
				r["effectiveGasPrice"] = "-1"
			case "wrong-hash":
				r["transactionHash"] = receiptTx1
			}
			server, c := rpcServer(t, func(w http.ResponseWriter, _ *http.Request) {
				if mode == "null" {
					rpcReply(t, w, nil)
				} else {
					rpcReply(t, w, r)
				}
			})
			defer server.Close()
			got, e := c.TransactionGasReceipt(context.Background(), receiptTx0)
			switch mode {
			case "valid", "zero-price":
				if e != nil || got == nil || got.GasUsed != "0x5208" {
					t.Fatal(got, e)
				}
			case "null":
				if e != nil || got != nil {
					t.Fatal(got, e)
				}
			default:
				if e == nil {
					t.Fatal("accepted invalid gas receipt", got)
				}
			}
		})
	}
}
