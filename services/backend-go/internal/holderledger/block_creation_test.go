package holderledger

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

type creationRPC struct {
	*replayRPC
	traceClient *chainrpc.Client
}

func (c creationRPC) TransactionCallTrace(ctx context.Context, h string) (chainrpc.CallTrace, error) {
	return c.traceClient.TransactionCallTrace(ctx, h)
}

func TestReplayCreationThroughRPC(t *testing.T) {
	for _, mismatch := range []bool{false, true} {
		t.Run(fmt.Sprint(mismatch), func(t *testing.T) {
			l, f, c := replayCase(t)
			for i := range f.txs.Transactions {
				f.txs.Transactions[i].Creation = true
				tr := f.traces[f.txs.Transactions[i].Hash]
				tr = chainrpc.CallTrace{Type: "CREATE", From: tr.From, To: "0x" + strings.Repeat("8", 40), Input: "0x6000", Value: "0x0", Calls: []chainrpc.CallTrace{tr}}
				f.txs.Transactions[i].To = tr.To
				f.txs.Transactions[i].Input = tr.Input
				f.traces[f.txs.Transactions[i].Hash] = tr
			}
			before, _ := json.Marshal(l)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req struct{ Params []json.RawMessage }
				json.NewDecoder(r.Body).Decode(&req)
				var h string
				json.Unmarshal(req.Params[0], &h)
				tr := f.traces[h]
				if mismatch {
					tr.Type = "CALL"
				}
				json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": tr})
			}))
			defer server.Close()
			client, e := chainrpc.New(server.URL)
			if e != nil {
				t.Fatal(e)
			}
			report, e := l.ReplayNextBlock(t.Context(), creationRPC{f, client}, c, f.parent, f.block)
			if mismatch {
				after, _ := json.Marshal(l)
				if e == nil || string(after) != string(before) {
					t.Fatal("mismatched creation must fail atomically")
				}
			} else if e != nil || report.Transactions != 2 || report.HistoryVerified || report.PublicationEligible {
				t.Fatalf("%+v %v", report, e)
			}
		})
	}
}
