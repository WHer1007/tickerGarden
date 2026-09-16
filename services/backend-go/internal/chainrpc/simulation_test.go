package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

const (
	simulationFrom = "0x0000000000000000000000000000000000000001"
	simulationTo   = "0x0000000000000000000000000000000000000002"
	simulationData = "0x12345678"
)

func TestSimulateAtBuildsHashPinnedEthCall(t *testing.T) {
	calls := 0
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		var req struct {
			Method string
			Params []json.RawMessage
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req.Method != "eth_call" || len(req.Params) != 2 {
			t.Fatalf("unexpected simulation request: method=%q params=%d", req.Method, len(req.Params))
		}
		var call map[string]string
		var block struct {
			BlockHash        string `json:"blockHash"`
			RequireCanonical bool   `json:"requireCanonical"`
		}
		if err := json.Unmarshal(req.Params[0], &call); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(req.Params[1], &block); err != nil {
			t.Fatal(err)
		}
		if call["from"] != simulationFrom || call["to"] != simulationTo || call["data"] != simulationData || call["value"] != "0x0" {
			t.Errorf("unexpected call object: %#v", call)
		}
		if block.BlockHash != testHash || !block.RequireCanonical {
			t.Errorf("simulation was not EIP-1898 pinned: %#v", block)
		}
		rpcReply(t, w, "0x")
	})
	defer s.Close()

	result, err := c.SimulateAt(context.Background(), simulationFrom, simulationTo, simulationData, testHash)
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 0 || calls != 1 {
		t.Fatalf("result=%x calls=%d, want empty result and one eth_call", result, calls)
	}
}

func TestSimulateAtRejectsInvalidSenderBeforeNetwork(t *testing.T) {
	calls := 0
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		t.Error("invalid simulation sender reached the network")
	})
	defer s.Close()

	for _, from := range []string{
		"0x0000000000000000000000000000000000000000",
		"0x1",
		"not-an-address",
	} {
		t.Run(from, func(t *testing.T) {
			if _, err := c.SimulateAt(context.Background(), from, simulationTo, simulationData, testHash); err == nil {
				t.Fatal("invalid sender accepted")
			}
		})
	}
	if calls != 0 {
		t.Fatalf("invalid sender caused %d network calls", calls)
	}
}

func TestSimulateAtPropagatesRevertAndRejectsMalformedData(t *testing.T) {
	tests := []struct {
		name    string
		result  string
		write   func(http.ResponseWriter)
		wantErr bool
	}{
		{name: "rpc revert", write: func(w http.ResponseWriter) {
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"execution reverted"}}`))
		}, wantErr: true},
		{name: "malformed data", result: "0x1", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				if tc.write != nil {
					tc.write(w)
				} else {
					rpcReply(t, w, tc.result)
				}
			})
			defer s.Close()
			if _, err := c.SimulateAt(context.Background(), simulationFrom, simulationTo, simulationData, testHash); (err != nil) != tc.wantErr {
				t.Fatalf("error=%v, wantErr=%v", err, tc.wantErr)
			}
		})
	}
}
