package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testHash = "0x0000000000000000000000000000000000000000000000000000000000000001"

func rpcServer(t *testing.T, fn http.HandlerFunc) (*httptest.Server, *Client) {
	t.Helper()
	s := httptest.NewServer(fn)
	c, err := New(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	return s, c
}

func rpcReply(t *testing.T, w http.ResponseWriter, result any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": result})
}

func TestChainIDValidRequestHeadersAndQuantity(t *testing.T) {
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("request headers: %s %q", r.Method, r.Header.Get("Content-Type"))
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req["jsonrpc"] != "2.0" || req["id"] != float64(1) || req["method"] != "eth_chainId" {
			t.Errorf("request: %#v", req)
		}
		rpcReply(t, w, "0x2a")
	})
	defer s.Close()
	n, err := c.ChainID(context.Background())
	if err != nil || n != 42 {
		t.Fatalf("ChainID = %d, %v", n, err)
	}
}

func TestQuantityRejectsMalformedAndOverflow(t *testing.T) {
	for _, in := range []string{"", "0x", "0X1", "0x01", "0xzz", "0x8000000000000000", "0xffffffffffffffff"} {
		if _, err := Quantity(in); err == nil {
			t.Errorf("Quantity(%q) accepted", in)
		}
	}
	for _, in := range []string{"0x0", "0x7fffffffffffffff", "0xabcdef"} {
		if _, err := Quantity(in); err != nil {
			t.Errorf("Quantity(%q): %v", in, err)
		}
	}
}

func TestCallRejectsEnvelopeErrorsNullAndWrongID(t *testing.T) {
	cases := []string{
		`{"jsonrpc":"2.0","id":1,"error":{"code":-1}}`,
		`{"jsonrpc":"2.0","id":1,"result":null}`,
		`{"jsonrpc":"2.0","id":2,"result":"0x1"}`,
		`{"jsonrpc":"1.0","id":1,"result":"0x1"}`,
	}
	for _, response := range cases {
		s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(response)) })
		_, err := c.ChainID(context.Background())
		s.Close()
		if err == nil {
			t.Errorf("response %s accepted", response)
		}
	}
}

func TestHeaderRejectsWrongHeightAndHash(t *testing.T) {
	for _, block := range []map[string]any{
		{"number": "0x2", "hash": testHash, "parentHash": testHash, "timestamp": "0x64"},
		{"number": "0x1", "hash": "0xbad", "parentHash": testHash, "timestamp": "0x64"},
	} {
		s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { rpcReply(t, w, block) })
		_, err := c.Header(context.Background(), "0x1")
		s.Close()
		if err == nil {
			t.Errorf("invalid block accepted: %#v", block)
		}
	}
}

func TestHeaderAcceptsValidResponse(t *testing.T) {
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		rpcReply(t, w, map[string]any{"number": "0x1", "hash": testHash, "parentHash": testHash, "timestamp": "0x64"})
	})
	defer s.Close()
	h, err := c.Header(context.Background(), "0x1")
	if err != nil || h.Number != "0x1" || h.Hash != testHash {
		t.Fatalf("Header = %#v, %v", h, err)
	}
}

func validLog() map[string]any {
	return map[string]any{"address": "0x0000000000000000000000000000000000000001", "topics": []string{testHash}, "data": "0x", "blockNumber": "0x1", "blockHash": testHash, "transactionHash": testHash, "transactionIndex": "0x0", "logIndex": "0x0", "removed": false}
}

func TestLogsValidAndRejectsDuplicateRemovedAndMismatched(t *testing.T) {
	base := validLog()
	for name, mutate := range map[string]func(map[string]any){
		"duplicate indexes": func(x map[string]any) { x["_duplicate"] = true },
		"removed":           func(x map[string]any) { x["removed"] = true },
		"wrong block hash":  func(x map[string]any) { x["blockHash"] = "0x" + strings.Repeat("2", 64) },
	} {
		s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
			x := map[string]any{}
			for k, v := range base {
				x[k] = v
			}
			mutate(x)
			if name == "duplicate indexes" {
				rpcReply(t, w, []any{x, base})
				return
			}
			rpcReply(t, w, []any{x})
		})
		_, err := c.filterLogs(context.Background(), Header{Number: "0x1", Hash: testHash})
		s.Close()
		if err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestLogsAcceptsValidAndEmptyArrays(t *testing.T) {
	for _, result := range []any{[]any{}, []any{validLog()}} {
		s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { rpcReply(t, w, result) })
		logs, err := c.filterLogs(context.Background(), Header{Number: "0x1", Hash: testHash})
		s.Close()
		if err != nil || len(logs) != len(result.([]any)) {
			t.Fatalf("Logs = %#v, %v", logs, err)
		}
	}
}

func TestCallRejectsOversizedResponse(t *testing.T) {
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"0x`))
		_, _ = w.Write([]byte(strings.Repeat("a", (16<<20)+1)))
	})
	defer s.Close()
	if _, err := c.ChainID(context.Background()); err == nil {
		t.Fatal("oversized response accepted")
	}
}

func TestRedirectIsNotFollowedAndEndpointIsNotLeaked(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("redirect target was contacted") }))
	defer target.Close()
	s := httptest.NewServer(http.RedirectHandler(target.URL, http.StatusTemporaryRedirect))
	defer s.Close()
	c, err := New(s.URL + "/secret-token")
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.ChainID(context.Background())
	if err == nil || strings.Contains(err.Error(), "secret-token") || strings.Contains(err.Error(), s.URL) {
		t.Fatalf("error leaked endpoint or was nil: %v", err)
	}
}
