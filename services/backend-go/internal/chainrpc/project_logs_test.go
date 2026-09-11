package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestProjectLogsSendsExplicitScopeAndSorts(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	otherHash := "0x" + strings.Repeat("2", 64)
	logs := []any{
		map[string]any{"address": address, "topics": []string{testHash}, "data": "0x", "blockNumber": "0x2", "blockHash": otherHash, "transactionHash": testHash, "transactionIndex": "0x1", "logIndex": "0x0", "removed": false},
		map[string]any{"address": address, "topics": []string{testHash}, "data": "0x", "blockNumber": "0x1", "blockHash": testHash, "transactionHash": testHash, "transactionIndex": "0x0", "logIndex": "0x0", "removed": false},
	}
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
			Params []any  `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req.Method != "eth_getLogs" || len(req.Params) != 1 {
			t.Fatalf("request = %#v", req)
		}
		f := req.Params[0].(map[string]any)
		if f["fromBlock"] != "0x1" || f["toBlock"] != "0x2" {
			t.Fatalf("range = %#v", f)
		}
		rpcReply(t, w, logs)
	})
	defer s.Close()
	got, err := c.ProjectLogs(context.Background(), []string{address}, []string{testHash}, 1, 2)
	if err != nil || len(got) != 2 || got[0].BlockNumber != "0x1" || got[1].BlockNumber != "0x2" {
		t.Fatalf("ProjectLogs = %#v, %v", got, err)
	}
}

func TestProjectLogsAcceptsEmptyAndRejectsInvalidScopeResults(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	base := validLog()
	cases := []struct {
		name   string
		result any
	}{
		{"empty", []any{}},
		{"outside address", []any{func() map[string]any {
			x := cloneLog(base)
			x["address"] = "0x0000000000000000000000000000000000000002"
			return x
		}()}},
		{"outside range", []any{func() map[string]any { x := cloneLog(base); x["blockNumber"] = "0x3"; return x }()}},
		{"wrong topic", []any{func() map[string]any {
			x := cloneLog(base)
			x["topics"] = []string{"0x" + strings.Repeat("3", 64)}
			return x
		}()}},
		{"removed", []any{func() map[string]any { x := cloneLog(base); x["removed"] = true; return x }()}},
		{"duplicate", []any{base, base}},
		{"mixed block hash", []any{base, func() map[string]any {
			x := cloneLog(base)
			x["logIndex"] = "0x1"
			x["blockHash"] = "0x" + strings.Repeat("4", 64)
			return x
		}()}},
		{"null", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { rpcReply(t, w, tc.result) })
			defer s.Close()
			got, err := c.ProjectLogs(context.Background(), []string{address}, []string{testHash}, 1, 2)
			if tc.name == "empty" {
				if err != nil || len(got) != 0 {
					t.Fatalf("empty = %#v, %v", got, err)
				}
			} else if err == nil {
				t.Fatalf("accepted invalid result: %#v", got)
			}
		})
	}
}

func TestScopedLogsUseIndexedPoolAndBurnTopics(t *testing.T) {
	manager := "0x0000000000000000000000000000000000000001"
	pool := "0x" + strings.Repeat("a", 64)
	topic := testHash
	zero := "0x" + strings.Repeat("0", 64)
	for _, tc := range []struct {
		name string
		call func(*Client) error
		want []any
	}{
		{"pool", func(c *Client) error {
			_, e := c.PoolLogs(context.Background(), manager, []string{topic}, []string{pool}, 1, 2)
			return e
		}, []any{[]any{topic}, []any{pool}}},
		{"burn", func(c *Client) error { _, e := c.BurnLogs(context.Background(), manager, topic, 1, 2); return e }, []any{[]any{topic}, nil, []any{zero}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Params []any `json:"params"`
				}
				if json.NewDecoder(r.Body).Decode(&req) != nil {
					t.Fatal("decode")
				}
				f := req.Params[0].(map[string]any)
				got := f["topics"]
				if !reflect.DeepEqual(got, tc.want) {
					t.Fatalf("topics=%#v want %#v", got, tc.want)
				}
				rpcReply(t, w, []any{})
			})
			defer s.Close()
			if err := tc.call(c); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProjectLogsRejectsOutOfBoundsRanges(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { t.Fatal("RPC called for invalid range") })
	defer s.Close()
	for _, q := range [][2]uint64{{2, 1}, {1, 2049}} {
		if _, err := c.ProjectLogs(context.Background(), []string{address}, []string{testHash}, q[0], q[1]); err == nil {
			t.Fatalf("accepted range %v", q)
		}
	}
}

func TestScopedLogsRejectMismatchedIndexedTopic(t *testing.T) {
	manager := "0x0000000000000000000000000000000000000001"
	pool := "0x" + strings.Repeat("a", 64)
	wrong := "0x" + strings.Repeat("b", 64)
	for _, tc := range []struct {
		name string
		call func(*Client) error
	}{
		{"pool", func(c *Client) error {
			_, e := c.PoolLogs(context.Background(), manager, []string{testHash}, []string{pool}, 1, 2)
			return e
		}},
		{"burn", func(c *Client) error { _, e := c.BurnLogs(context.Background(), manager, testHash, 1, 2); return e }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				x := validLog()
				x["address"] = manager
				if tc.name == "pool" {
					x["topics"] = []string{testHash, wrong}
				} else {
					x["topics"] = []string{testHash, "0x" + strings.Repeat("0", 64), wrong}
				}
				rpcReply(t, w, []any{x})
			})
			defer s.Close()
			if err := tc.call(c); err == nil {
				t.Fatal("accepted mismatched indexed topic")
			}
		})
	}
}

func cloneLog(x map[string]any) map[string]any {
	y := map[string]any{}
	for k, v := range x {
		y[k] = v
	}
	return y
}
