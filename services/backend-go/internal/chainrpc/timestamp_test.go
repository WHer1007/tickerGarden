package chainrpc

import (
	"context"
	"net/http"
	"testing"
)

func TestHeaderRejectsInvalidTimestamps(t *testing.T) {
	cases := []struct {
		name string
		ts   string
	}{
		{name: "missing", ts: ""},
		{name: "empty", ts: ""},
		{name: "leading zero", ts: "0x00"},
		{name: "negative", ts: "-0x1"},
		{name: "over signed 64", ts: "0x8000000000000000"},
		{name: "uint64 overflow", ts: "0x10000000000000000"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			block := map[string]any{
				"number": "0x1", "hash": testHash, "parentHash": testHash,
			}
			if tc.name != "missing" {
				block["timestamp"] = tc.ts
			}
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { rpcReply(t, w, block) })
			defer s.Close()
			if _, err := c.Header(context.Background(), "0x1"); err == nil {
				t.Fatalf("invalid timestamp %q accepted", tc.ts)
			}
		})
	}
}

func TestHeaderAcceptsZeroAndRegularTimestamps(t *testing.T) {
	for _, ts := range []string{"0x0", "0x64"} {
		t.Run(ts, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				rpcReply(t, w, map[string]any{"number": "0x1", "hash": testHash, "parentHash": testHash, "timestamp": ts})
			})
			defer s.Close()
			if h, err := c.Header(context.Background(), "0x1"); err != nil || h.Timestamp != ts {
				t.Fatalf("Header timestamp = %q, %v", h.Timestamp, err)
			}
		})
	}
}

func TestObserveRejectsReceiptBlockTimestampMismatch(t *testing.T) {
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		rpcReply(t, w, map[string]any{
			"number": "0x1", "hash": receiptBlockHash, "parentHash": receiptParentHash,
			"timestamp": "0x65", "transactions": []string{},
		})
	})
	defer s.Close()
	_, err := c.Observe(context.Background(), Header{
		Number: "0x1", Hash: receiptBlockHash, ParentHash: receiptParentHash, Timestamp: "0x64",
	})
	if err == nil {
		t.Fatal("receipt block with mismatched timestamp accepted")
	}
}
