package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestPendingNonceRequestsExactAccountAndPendingTag(t *testing.T) {
	const account = "0xAbCDef0123456789AbCDef0123456789AbCDef01"
	var requests int
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		var request struct {
			Method string
			Params []json.RawMessage
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.Method != "eth_getTransactionCount" || len(request.Params) != 2 {
			t.Fatalf("request = %#v", request)
		}
		var sender string
		var tag string
		if err := json.Unmarshal(request.Params[0], &sender); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(request.Params[1], &tag); err != nil {
			t.Fatal(err)
		}
		if sender != account || tag != "pending" {
			t.Fatalf("params = %q, %q", sender, tag)
		}
		rpcReply(t, w, "0x2a")
	})
	defer s.Close()

	nonce, err := c.PendingNonce(context.Background(), account)
	if err != nil || nonce != 42 {
		t.Fatalf("PendingNonce = %d, %v", nonce, err)
	}
	if requests != 1 {
		t.Fatalf("requests = %d, want 1", requests)
	}
}

func TestPendingNonceAcceptsValidQuantities(t *testing.T) {
	for _, tc := range []struct {
		quantity string
		want     uint64
	}{
		{"0x0", 0},
		{"0xabcdef", 0xabcdef},
		{"0x7fffffffffffffff", 1<<63 - 1},
	} {
		t.Run(tc.quantity, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				rpcReply(t, w, tc.quantity)
			})
			defer s.Close()
			nonce, err := c.PendingNonce(context.Background(), "0x0000000000000000000000000000000000000001")
			if err != nil || nonce != tc.want {
				t.Fatalf("PendingNonce = %d, %v", nonce, err)
			}
		})
	}
}

func TestPendingNonceRejectsInvalidQuantity(t *testing.T) {
	for _, quantity := range []string{"", "0x", "0X1", "0x01", "0xzz", "0xffffffffffffffff", "0x8000000000000000"} {
		t.Run(quantity, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				rpcReply(t, w, quantity)
			})
			defer s.Close()
			if _, err := c.PendingNonce(context.Background(), "0x0000000000000000000000000000000000000001"); err == nil {
				t.Fatalf("PendingNonce accepted %q", quantity)
			}
		})
	}
}

func TestPendingNonceRejectsInvalidAccountWithoutRequest(t *testing.T) {
	requests := 0
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		t.Error("invalid account reached RPC server")
	})
	defer s.Close()

	for _, account := range []string{
		"",
		"0x1",
		"0X0000000000000000000000000000000000000001",
		"0x0000000000000000000000000000000000000000",
		"0x000000000000000000000000000000000000000g",
	} {
		t.Run(account, func(t *testing.T) {
			if _, err := c.PendingNonce(context.Background(), account); err == nil {
				t.Fatalf("PendingNonce accepted account %q", account)
			}
		})
	}
	if requests != 0 {
		t.Fatalf("requests = %d, want 0", requests)
	}
}
