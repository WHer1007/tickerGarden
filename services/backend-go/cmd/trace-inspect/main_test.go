package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDescribeAndInvalidUsage(t *testing.T) {
	for _, tc := range []struct {
		args []string
		code int
	}{{[]string{"--describe"}, 0}, {nil, 1}, {[]string{"--once", "0", "secret"}, 1}} {
		var out, err bytes.Buffer
		if got := run(context.Background(), tc.args, &out, &err); got != tc.code {
			t.Fatal(got)
		}
		if strings.Contains(out.String()+err.String(), "secret") {
			t.Fatal("echoed input")
		}
	}
}

func TestProbeRPCAndChainFence(t *testing.T) {
	for _, mode := range []string{"create", "http", "wrong-chain"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req struct{ Method string }
				json.NewDecoder(r.Body).Decode(&req)
				if req.Method == "eth_chainId" {
					fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"result":"0x1"}`)
					return
				}
				calls++
				if mode == "http" {
					w.WriteHeader(400)
					fmt.Fprint(w, "SECRET")
					return
				}
				fmt.Fprintf(w, `{"jsonrpc":"2.0","id":1,"result":{"type":"CREATE","from":"0x%s","to":"0x%s","input":"0x"}}`, strings.Repeat("1", 40), strings.Repeat("2", 40))
			}))
			defer s.Close()
			t.Setenv("TG_HOLDER_RPC_URL", s.URL)
			id := "1"
			expected := 0
			if mode == "wrong-chain" {
				id = "2"
				expected = 1
			}
			if mode == "http" {
				expected = 2
			}
			var out, err bytes.Buffer
			if got := run(t.Context(), []string{"--once", id, "0x" + strings.Repeat("a", 64)}, &out, &err); got != expected {
				t.Fatal(got, out.String(), err.String())
			}
			if mode == "wrong-chain" && calls != 0 {
				t.Fatal("trace on wrong chain")
			}
			if strings.Contains(out.String()+err.String(), "SECRET") {
				t.Fatal("leak")
			}
			if mode != "wrong-chain" && !strings.Contains(out.String(), `"publicationEligible":false`) {
				t.Fatal("missing gate")
			}
		})
	}
}
