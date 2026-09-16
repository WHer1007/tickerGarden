package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestNonceAtHashRequestsExactHashPinnedCanonicalState(t *testing.T) {
	const account = "0xAbCDef0123456789AbCDef0123456789AbCDef01"
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string
			Params []json.RawMessage
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req.Method != "eth_getTransactionCount" || len(req.Params) != 2 {
			t.Fatalf("request = %#v", req)
		}
		var gotAccount string
		var selector struct {
			BlockHash        string `json:"blockHash"`
			RequireCanonical bool   `json:"requireCanonical"`
		}
		if err := json.Unmarshal(req.Params[0], &gotAccount); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(req.Params[1], &selector); err != nil {
			t.Fatal(err)
		}
		if gotAccount != account || selector.BlockHash != testHash || !selector.RequireCanonical {
			t.Fatalf("params = %q, %#v", gotAccount, selector)
		}
		rpcReply(t, w, "0x2a")
	})
	defer s.Close()
	n, err := c.NonceAtHash(context.Background(), account, testHash)
	if err != nil || n != 42 {
		t.Fatalf("NonceAtHash = %d, %v", n, err)
	}
}

func TestNonceAtHashRejectsMalformedInputWithoutRPC(t *testing.T) {
	requests := 0
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { requests++; t.Error("malformed input reached RPC") })
	defer s.Close()
	for _, tc := range [][2]string{{"", testHash}, {"0x1", testHash}, {"0x0000000000000000000000000000000000000000", testHash}, {"0x0000000000000000000000000000000000000001", "0x1"}, {"0x0000000000000000000000000000000000000001", ""}} {
		if _, err := c.NonceAtHash(context.Background(), tc[0], tc[1]); err == nil {
			t.Errorf("accepted %q, %q", tc[0], tc[1])
		}
	}
	if requests != 0 {
		t.Fatalf("requests = %d, want 0", requests)
	}
}

func TestNonceAtHashRejectsMalformedQuantity(t *testing.T) {
	for _, quantity := range []string{"", "0x", "0X1", "0x01", "0xzz", "0xffffffffffffffff", "0x8000000000000000"} {
		s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { rpcReply(t, w, quantity) })
		_, err := c.NonceAtHash(context.Background(), "0x0000000000000000000000000000000000000001", testHash)
		s.Close()
		if err == nil {
			t.Errorf("accepted quantity %q", quantity)
		}
	}
}
