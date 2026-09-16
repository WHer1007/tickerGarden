package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestStateReadsPinCanonicalHash(t *testing.T) {
	for _, method := range []string{"eth_getCode", "eth_call"} {
		t.Run(method, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Method string
					Params []json.RawMessage
				}
				if e := json.NewDecoder(r.Body).Decode(&request); e != nil {
					t.Error(e)
				}
				var pin struct {
					BlockHash        string
					RequireCanonical bool
				}
				if len(request.Params) != 2 {
					t.Error("wrong state args")
					return
				}
				if e := json.Unmarshal(request.Params[1], &pin); e != nil || pin.BlockHash != testHash || !pin.RequireCanonical || request.Method != method {
					t.Error("state read not canonical hash pinned")
				}
				rpcReply(t, w, "0x00")
			})
			defer s.Close()
			var e error
			if method == "eth_getCode" {
				_, e = c.CodeAt(context.Background(), "0x0000000000000000000000000000000000000001", testHash)
			} else {
				_, e = c.CallAt(context.Background(), "0x0000000000000000000000000000000000000001", "0x12345678", testHash)
			}
			if e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestUnavailableHistoricalStateNeverFallsBack(t *testing.T) {
	calls := 0
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"missing trie"}}`))
	})
	defer s.Close()
	if _, e := c.CodeAt(context.Background(), "0x0000000000000000000000000000000000000001", testHash); e == nil || calls != 1 {
		t.Fatal("historical state failed open")
	}
	if _, e := c.BalanceAt(context.Background(), "0x0000000000000000000000000000000000000001", testHash); e == nil || calls != 2 {
		t.Fatal("balance historical state failed open")
	}
}

func TestNativeBalanceQuantityAndHashPin(t *testing.T) {
	for _, value := range []string{"0x0", "0x1", "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "0x00", "0x", "-1", "0x10000000000000000000000000000000000000000000000000000000000000000"} {
		t.Run(value, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Method string
					Params []json.RawMessage
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Fatal(err)
				}
				var pin struct {
					BlockHash        string
					RequireCanonical bool
				}
				if len(request.Params) != 2 {
					t.Fatal("wrong params")
				}
				json.Unmarshal(request.Params[1], &pin)
				if request.Method != "eth_getBalance" || pin.BlockHash != testHash || !pin.RequireCanonical {
					t.Error("unbound native balance")
				}
				rpcReply(t, w, value)
			})
			defer s.Close()
			result, err := c.BalanceAt(context.Background(), "0x0000000000000000000000000000000000000001", testHash)
			valid := value == "0x0" || value == "0x1" || len(value) == 66
			if valid && err != nil || !valid && err == nil {
				t.Fatal(value, result, err)
			}
			if len(value) == 66 && result != "115792089237316195423570985008687907853269984665640564039457584007913129639935" {
				t.Fatal("balance lost precision")
			}
		})
	}
}
