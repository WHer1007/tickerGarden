package analytics

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestPersistedPoolPairing(t *testing.T) {
	for _, mode := range []string{"good", "no-fee", "missing", "earlier", "other-tx", "wrong-id", "wrong-pool", "args", "sender-missing", "sender-invalid"} {
		swap, fee, b := poolFixture(true, true)
		swap.Args["sender"] = b.Currency1
		source := CurveSource{ChainID: 4663, BlockNumber: "1", BlockHash: "0x" + strings.Repeat("a", 64), TransactionHash: "0x" + strings.Repeat("b", 64), Emitter: b.Currency0, LogIndex: 3}
		source.EventKey = fmt.Sprintf("4663:%s:3", source.TransactionHash)
		fs := source
		fs.LogIndex = 5
		fs.EventKey = fmt.Sprintf("4663:%s:5", source.TransactionHash)
		fs.Emitter = b.Currency1
		feeID := "0x" + strings.Repeat("c", 64)
		fee.Args["feeId"] = feeID
		fee.Args["feeNonce"] = "1"
		key := fs.EventKey
		switch mode {
		case "sender-missing":
			delete(swap.Args, "sender")
		case "sender-invalid":
			swap.Args["sender"] = "0x123"
		case "earlier":
			fs.LogIndex = 2
		case "other-tx":
			fs.TransactionHash = "0x" + strings.Repeat("d", 64)
		case "wrong-id":
			fee.Args["feeId"] = b.PoolID
		case "wrong-pool":
			fee.Args["poolId"] = b.MarketID
		case "no-fee":
			key = ""
			feeID = ""
		}
		er, _ := json.Marshal(eventRow{Provenance: source, Signature: swap.Signature, Args: swap.Args})
		if mode == "args" {
			swap.Args["amount0"] = "1001"
		}
		sr, _ := json.Marshal(map[string]any{"eventKey": source.EventKey, "poolId": b.PoolID, "values": swap.Args, "provenance": source, "hookFeeEventKey": key, "feeId": feeID})
		fr, _ := json.Marshal(eventRow{Provenance: fs, Signature: fee.Signature, Args: fee.Args})
		if mode == "no-fee" || mode == "missing" {
			fr = nil
		}
		result, err := normalizePoolRows(er, sr, fr, 4663, source.EventKey, b)
		ok := mode == "good" || mode == "no-fee"
		if (err == nil) != ok {
			t.Fatalf("%s: %+v %v", mode, result, err)
		}
		if mode == "good" && (result.Sender != b.Currency1 || result.FeeSource == nil || *result.Amounts.MemeCallerDelta != "900") {
			t.Fatal(result)
		}
		if mode == "no-fee" && (result.FeeSource != nil || result.Amounts.FeeRaw != nil) {
			t.Fatal("invented fee")
		}
	}
}
