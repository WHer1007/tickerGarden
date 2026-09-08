package chainrpc

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestAuthenticatedTransactionsCanonicalFence(t *testing.T) {
	for _, reorg := range []bool{false, true} {
		t.Run(map[bool]string{false: "valid", true: "reorg"}[reorg], func(t *testing.T) {
			raw, hash := txFixture(t)
			server, client := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Method string
					Params []json.RawMessage
				}
				if json.NewDecoder(r.Body).Decode(&req) != nil {
					t.Error("request decode")
					return
				}
				switch req.Method {
				case "eth_chainId":
					rpcReply(t, w, "0xb626")
				case "eth_getBlockByHash":
					var full bool
					if len(req.Params) != 2 || json.Unmarshal(req.Params[1], &full) != nil || !full {
						t.Error("must request complete transactions")
					}
					rpcReply(t, w, json.RawMessage(raw))
				case "eth_getBlockByNumber":
					var body map[string]json.RawMessage
					json.Unmarshal(raw, &body)
					if reorg {
						body["hash"] = json.RawMessage(`"` + testHash + `"`)
					}
					rpcReply(t, w, body)
				default:
					t.Error("unexpected RPC", req.Method)
				}
			})
			defer server.Close()
			out, e := client.AuthenticatedTransactions(t.Context(), 46630, hash)
			if reorg {
				if e == nil {
					t.Fatal("accepted changed canonical header")
				}
			} else if e != nil || len(out.Transactions) != 1 {
				t.Fatalf("valid %+v %v", out, e)
			}
		})
	}
}
