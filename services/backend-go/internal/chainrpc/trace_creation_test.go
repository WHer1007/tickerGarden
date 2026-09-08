package chainrpc

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestTransactionCallTraceCreationRootRules(t *testing.T) {
	for _, tc := range []struct {
		name, typ string
		ok        bool
	}{{"call", "CALL", true}, {"create", "CREATE", true}, {"delegate", "DELEGATECALL", false}, {"static", "STATICCALL", false}, {"create2", "CREATE2", false}} {
		t.Run(tc.name, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				tr := traceFixture()
				tr.Type = tc.typ
				rpcReply(t, w, tr)
			})
			defer s.Close()
			_, e := c.TransactionCallTrace(context.Background(), "0x"+strings.Repeat("a", 64))
			if (e == nil) != tc.ok {
				t.Fatalf("type %s err=%v", tc.typ, e)
			}
		})
	}
}
func TestTransactionCallTraceCreationMalformed(t *testing.T) {
	for _, bad := range []string{"address", "input"} {
		t.Run(bad, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				tr := traceFixture()
				tr.Type = "CREATE"
				if bad == "address" {
					tr.To = "invalid"
				}
				if bad == "input" {
					tr.Input = "0x1"
				}
				rpcReply(t, w, tr)
			})
			defer s.Close()
			if _, e := c.TransactionCallTrace(context.Background(), "0x"+strings.Repeat("a", 64)); e == nil {
				t.Fatal("accepted malformed create")
			}
		})
	}
}
