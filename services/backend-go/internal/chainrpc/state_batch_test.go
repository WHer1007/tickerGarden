package chainrpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestParallelStateReadsRemainPinnedAndBounded(t *testing.T) {
	var active, peak atomic.Int32
	block := "0x" + fmt.Sprintf("%064x", 99)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := active.Add(1)
		defer active.Add(-1)
		for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
		}
		var body struct {
			ID     int               `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("request decode")
			return
		}
		var pin map[string]any
		_ = json.Unmarshal(body.Params[1], &pin)
		if pin["blockHash"] != block || pin["requireCanonical"] != true {
			t.Error("unpinned read")
		}
		var address string
		if body.Method == "eth_getCode" {
			_ = json.Unmarshal(body.Params[0], &address)
		} else {
			var call map[string]string
			_ = json.Unmarshal(body.Params[0], &call)
			address = call["to"]
		}
		time.Sleep(20 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": body.ID, "result": "0x" + address[len(address)-4:]})
	}))
	defer server.Close()
	c, _ := New(server.URL)
	var addresses []string
	var calls []StateCall
	for i := 0; i < 13; i++ {
		a := fmt.Sprintf("0x%040x", i+1)
		addresses = append(addresses, a)
		calls = append(calls, StateCall{Address: a, Data: "0x12345678"})
	}
	for _, fn := range []func() ([][]byte, error){func() ([][]byte, error) { return c.CodesAt(context.Background(), addresses, block) }, func() ([][]byte, error) { return c.CallsAt(context.Background(), calls, block) }} {
		out, e := fn()
		if e != nil || len(out) != 13 {
			t.Fatalf("%d %v", len(out), e)
		}
		for i, v := range out {
			if string(v) != string([]byte{0, byte(i + 1)}) {
				t.Fatal("bad result order/content")
			}
		}
	}
	if peak.Load() < 2 || peak.Load() > 4 {
		t.Fatalf("parallel bound %d", peak.Load())
	}
}
func TestParallelStateFailureDoesNotReturnPartialResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	c, _ := New(server.URL)
	h := fmt.Sprintf("0x%064x", 1)
	a := fmt.Sprintf("0x%040x", 1)
	if out, e := c.CodesAt(context.Background(), []string{a, a}, h); e == nil || out != nil {
		t.Fatal("partial codes escaped")
	}
	if out, e := c.CallsAt(context.Background(), []StateCall{{Address: a, Data: "0x"}}, h); e == nil || out != nil {
		t.Fatal("partial calls escaped")
	}
	if out, e := c.CodesAt(context.Background(), nil, h); e == nil || out != nil {
		t.Fatal("empty batch accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if out, e := c.CodesAt(ctx, []string{a}, h); e == nil || out != nil {
		t.Fatal("cancelled batch accepted")
	}
}
