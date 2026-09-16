package chainrpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestTraceDiagnosticsAreSafeAndNoRetry(t *testing.T) {
	for _, tc := range []struct {
		name, kind   string
		status, code int
	}{
		{"http400", "http_status", 400, 0}, {"limited", "http_status", 429, 0}, {"method", "rpc_error", 0, -32601}, {"invalid", "invalid_trace", 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if tc.status != 0 {
					w.WriteHeader(tc.status)
					fmt.Fprint(w, "SECRET_ENDPOINT_AND_KEY")
					return
				}
				if tc.code != 0 {
					fmt.Fprintf(w, `{"jsonrpc":"2.0","id":1,"error":{"code":%d,"message":"SECRET_ENDPOINT_AND_KEY","data":"SECRET_ENDPOINT_AND_KEY"}}`, tc.code)
					return
				}
				rpcReply(t, w, map[string]string{"type": "SECRET_ENDPOINT_AND_KEY"})
			})
			defer s.Close()
			_, err := c.TransactionCallTrace(t.Context(), "0x"+strings.Repeat("a", 64))
			var detail *TraceError
			if !errors.Is(err, ErrTraceUnavailable) || !errors.As(err, &detail) || detail.Kind != tc.kind || detail.HTTPStatus != tc.status || detail.RPCCode != tc.code {
				t.Fatalf("diagnostic %v", err)
			}
			b, _ := json.Marshal(detail)
			if strings.Contains(err.Error()+string(b), "SECRET") || calls != 1 {
				t.Fatal("secret exposed or retried")
			}
		})
	}
}
func TestTraceCancellationPreservesSentinel(t *testing.T) {
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { t.Error("request after cancellation") })
	defer s.Close()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := c.TransactionCallTrace(ctx, "0x"+strings.Repeat("a", 64))
	var detail *TraceError
	if !errors.Is(err, context.Canceled) || !errors.Is(err, ErrTraceUnavailable) || !errors.As(err, &detail) || detail.Kind != "transport" {
		t.Fatalf("%v", err)
	}
}
