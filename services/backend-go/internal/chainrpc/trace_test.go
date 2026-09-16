package chainrpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func traceFixture() CallTrace {
	return CallTrace{Type: "CALL", From: "0x" + strings.Repeat("1", 40), To: "0x" + strings.Repeat("2", 40), Input: "0x0102", Value: "0x0", Output: "0x00", Calls: []CallTrace{{Type: "STATICCALL", From: "0x" + strings.Repeat("2", 40), To: "0x" + strings.Repeat("3", 40), Input: "0x"}}}
}
func TestTransactionCallTraceProtocolAndValidation(t *testing.T) {
	for _, mode := range []string{"valid", "error-frame", "null", "rpc-error", "address", "odd-input", "bad-output", "value", "type", "depth", "nodes", "bytes"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				var req struct {
					Method string
					Params []json.RawMessage
				}
				if json.NewDecoder(r.Body).Decode(&req) != nil || req.Method != "debug_traceTransaction" || len(req.Params) != 2 {
					t.Fatal("wrong request")
				}
				var opts struct {
					Tracer       string
					Timeout      string
					TracerConfig struct {
						OnlyTopCall bool
						WithLog     bool
					}
				}
				if json.Unmarshal(req.Params[1], &opts) != nil || opts.Tracer != "callTracer" || opts.Timeout != "15s" || opts.TracerConfig.OnlyTopCall || opts.TracerConfig.WithLog {
					t.Error("wrong trace options")
				}
				tr := traceFixture()
				switch mode {
				case "null":
					rpcReply(t, w, nil)
					return
				case "rpc-error":
					fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not supported"}}`)
					return
				case "error-frame":
					tr.Calls[0].Error = "execution reverted"
				case "address":
					tr.From = "invalid"
				case "odd-input":
					tr.Input = "0x1"
				case "bad-output":
					tr.Output = "0xz1"
				case "value":
					tr.Value = "0x00"
				case "type":
					tr.Type = "UNKNOWN"
				case "depth":
					for range 70 {
						child := tr
						tr = traceFixture()
						tr.Calls = []CallTrace{child}
					}
				case "nodes":
					tr.Calls = make([]CallTrace, 4097)
					for i := range tr.Calls {
						tr.Calls[i] = traceFixture()
					}
				case "bytes":
					tr.Output = "0x" + strings.Repeat("00", 65537)
				}
				rpcReply(t, w, tr)
			})
			defer s.Close()
			got, err := c.TransactionCallTrace(context.Background(), "0x"+strings.Repeat("a", 64))
			if mode == "valid" || mode == "error-frame" {
				if err != nil || len(got.Calls) != 1 {
					t.Fatal(got, err)
				}
			} else if err == nil {
				t.Fatal("accepted", mode)
			}
			if calls != 1 {
				t.Fatal("retried trace", calls)
			}
		})
	}
}
func TestTransactionCallTracePreflightAndCancel(t *testing.T) {
	calls := 0
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { calls++; rpcReply(t, w, traceFixture()) })
	defer s.Close()
	if _, err := c.TransactionCallTrace(context.Background(), "bad"); err == nil {
		t.Fatal("bad hash")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.TransactionCallTrace(ctx, "0x"+strings.Repeat("a", 64)); err == nil {
		t.Fatal("cancelled trace")
	}
	if calls != 0 {
		t.Fatal("unexpected RPC")
	}
}

func TestCallTraceNodeBoundary(t *testing.T) {
	root := traceFixture()
	leaf := root.Calls[0]
	root.Calls = make([]CallTrace, 4095)
	for i := range root.Calls {
		root.Calls[i] = leaf
	}
	nodes, total := 0, 0
	if !validTrace(root, 0, &nodes, &total) || nodes != 4096 {
		t.Fatal("valid node limit rejected", nodes, total)
	}
	root.Calls = append(root.Calls, leaf)
	nodes, total = 0, 0
	if validTrace(root, 0, &nodes, &total) {
		t.Fatal("excess node accepted")
	}
}
