package analytics

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestPersistedCurveRowsMustAgree(t *testing.T) {
	hash := "0x" + strings.Repeat("1", 64)
	key := fmt.Sprintf("4663:%s:7", hash)
	source := CurveSource{ChainID: 4663, BlockNumber: "12", BlockHash: hash, TransactionHash: hash, LogIndex: 7, Emitter: "0x" + strings.Repeat("2", 40), EventKey: key}
	for _, mode := range []string{"good", "amount", "source", "market", "actor", "key", "refund"} {
		e := curveEvent("buy")
		e.Args["buyer"] = "0x" + strings.Repeat("3", 40)
		e.Args["recipient"] = "0x" + strings.Repeat("4", 40)
		vals := map[string]any{}
		for k, v := range e.Args {
			vals[k] = v
		}
		vals["marketId"] = hash
		other := source
		rowKey := key
		switch mode {
		case "amount":
			vals["quoteIn"] = "9000000"
		case "source":
			other.LogIndex++
		case "market":
			vals["marketId"] = "bad"
		case "actor":
			e.Args["buyer"] = "bad"
			vals["buyer"] = "bad"
		case "key":
			rowKey = "wrong"
		case "refund":
			e.Signature = "CurveBuyRefunded(address,uint256)"
		}
		raw, _ := json.Marshal(map[string]any{"provenance": source, "signature": e.Signature, "args": e.Args})
		row, _ := json.Marshal(map[string]any{"key": rowKey, "provenance": other, "values": vals})
		result, err := normalizeCurveRows(raw, row, 4663, key, 6)
		if (err == nil) != (mode == "good") {
			t.Fatalf("%s: %+v %v", mode, result, err)
		}
		if mode == "good" && (result.Classification != "unclassified" || result.ActorConfidence != "contract_caller_not_verified_wallet" || result.Source != source || result.Amounts.PriceNumerator != "97") {
			t.Fatal(result)
		}
	}
}
