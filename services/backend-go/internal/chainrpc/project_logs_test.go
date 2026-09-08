package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
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

func cloneLog(x map[string]any) map[string]any {
	y := map[string]any{}
	for k, v := range x {
		y[k] = v
	}
	return y
}
