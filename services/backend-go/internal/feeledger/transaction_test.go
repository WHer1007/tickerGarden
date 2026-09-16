package feeledger

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

func transactionInput(t *testing.T, name string, index int, values map[string]string) Input {
	t.Helper()
	raw, err := os.ReadFile("../events/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog events.Catalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		t.Fatal(err)
	}
	for _, definition := range catalog.Events {
		if definition.Name != name {
			continue
		}
		log := chainrpc.Log{Address: vault, BlockNumber: "0x1", BlockHash: "0x" + strings.Repeat("a", 64), TransactionHash: "0x" + strings.Repeat("b", 64), TransactionIndex: "0x0", LogIndex: fmt.Sprintf("0x%x", index), Topics: []string{definition.Topic0}, Data: "0x"}
		for _, field := range definition.Inputs {
			value := values[field.Name]
			if field.Name == "marketId" {
				value = market.ID
			}
			if value == "" {
				value = "0"
			}
			n := new(big.Int)
			base := 10
			if strings.HasPrefix(value, "0x") {
				base = 16
				value = value[2:]
			}
			if _, ok := n.SetString(value, base); !ok {
				t.Fatal(value)
			}
			word := fmt.Sprintf("%064x", n)
			if field.Indexed {
				log.Topics = append(log.Topics, "0x"+word)
			} else {
				log.Data += word
			}
		}
		return Input{Module: "ProtocolFeeVault", Log: log}
	}
	t.Fatal("event missing", name)
	return Input{}
}

func TestTransactionConversionCreditOrder(t *testing.T) {
	l := newLedger(t)
	apply(t, l, "FeeBucketsCredited", map[string]any{"feeAsset": market.Meme, "creatorAmount": maximum.String(), "stakerAmount": "0", "platformAmount": "0"})
	credit := transactionInput(t, "FeeBucketsCredited", 0, map[string]string{"feeAsset": market.Meme, "creatorAmount": "1"})
	conversion := transactionInput(t, "RewardConverted", 1, map[string]string{"creatorEpoch": "1", "memeSpent": "2", "quoteReceived": "3"})
	if _, err := l.Apply(credit.Module, credit.Log); err == nil {
		t.Fatal("single-event overflow accepted")
	}
	if changed, err := l.ApplyTransaction([]Input{credit, conversion}); err != nil || !changed {
		t.Fatal(changed, err)
	}
	want := new(big.Int).Sub(maximum, big.NewInt(1)).String()
	if balance(l, market.Meme)[0] != want || balance(l, market.Quote)[0] != "3" {
		t.Fatal(l.Snapshot())
	}
}

func TestTransactionRejectsWithoutPartialMutation(t *testing.T) {
	for _, mode := range []string{"final underflow", "final overflow", "aggregate overflow", "duplicate", "reverse", "other transaction", "other block", "other height", "other transaction index", "removed", "malformed", "empty", "oversize"} {
		t.Run(mode, func(t *testing.T) {
			l := newLedger(t)
			credit := transactionInput(t, "FeeBucketsCredited", 0, map[string]string{"feeAsset": market.Meme, "creatorAmount": "1"})
			conversion := transactionInput(t, "RewardConverted", 1, map[string]string{"creatorEpoch": "1", "memeSpent": "2"})
			inputs := []Input{credit, conversion}
			switch mode {
			case "final overflow", "aggregate overflow":
				apply(t, l, "FeeBucketsCredited", map[string]any{"feeAsset": market.Meme, "creatorAmount": maximum.String(), "stakerAmount": "0", "platformAmount": "0"})
				inputs = []Input{credit}
				if mode == "aggregate overflow" {
					inputs[0] = transactionInput(t, "FeeBucketsCredited", 0, map[string]string{"feeAsset": market.Meme, "stakerAmount": "1"})
				}
			case "duplicate":
				inputs[1].Log.LogIndex = "0x0"
			case "reverse":
				inputs[0], inputs[1] = inputs[1], inputs[0]
			case "other transaction":
				inputs[1].Log.TransactionHash = "0x" + strings.Repeat("c", 64)
			case "other block":
				inputs[1].Log.BlockHash = "0x" + strings.Repeat("c", 64)
			case "other height":
				inputs[1].Log.BlockNumber = "0x2"
			case "other transaction index":
				inputs[1].Log.TransactionIndex = "0x1"
			case "removed":
				inputs[1].Log.Removed = true
			case "malformed":
				inputs[1].Log.Data = "0x00"
			case "empty":
				inputs = nil
			case "oversize":
				inputs[1].Log.Data = strings.Repeat("0", (16<<20)+1)
			}
			before := l.Snapshot()
			totals := map[string]string{}
			for key, value := range l.totals {
				totals[key] = value.String()
			}
			if changed, err := l.ApplyTransaction(inputs); err == nil || changed || !reflect.DeepEqual(before, l.Snapshot()) {
				t.Fatal(changed, err, l.Snapshot())
			}
			for key, value := range l.totals {
				if totals[key] != value.String() {
					t.Fatal("total mutated")
				}
			}
		})
	}
}
