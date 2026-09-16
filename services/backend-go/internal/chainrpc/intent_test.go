package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestIntentSimulationTransmitsExactFeeAndNonce(t *testing.T) {
	call := IntentCall{From: "0x0000000000000000000000000000000000000001", To: "0x0000000000000000000000000000000000000002", Data: "0x12345678", Value: "0x0", Gas: "0xc350", Nonce: "0x3", MaxFeePerGas: "0x64", MaxPriorityFeePerGas: "0x2"}
	const hash = "0x1111111111111111111111111111111111111111111111111111111111111111"
	server, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Method string
			Params []json.RawMessage
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil || request.Method != "eth_call" || len(request.Params) != 2 {
			t.Error("invalid request")
			return
		}
		var got IntentCall
		var pin struct {
			BlockHash        string
			RequireCanonical bool
		}
		if json.Unmarshal(request.Params[0], &got) != nil || json.Unmarshal(request.Params[1], &pin) != nil || got != call || pin.BlockHash != hash || !pin.RequireCanonical {
			t.Error("wrong exact transaction")
		}
		rpcReply(t, w, "0x01")
	})
	defer server.Close()
	raw, e := c.SimulateIntentAt(context.Background(), call, hash)
	if e != nil || len(raw) != 1 || raw[0] != 1 {
		t.Fatal(raw, e)
	}
}
