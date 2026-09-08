package feeledger

import (
	"math/big"
	"reflect"
	"testing"
)

func creatorLedger(t *testing.T) *CreatorLedger {
	t.Helper()
	l, err := NewCreatorLedger(vault, []CreatorEpoch{{MarketID: market.ID, Epoch: "1", Meme: market.Meme, Quote: market.Quote}, {MarketID: market.ID, Epoch: "2", Meme: market.Meme, Quote: market.Quote}})
	if err != nil {
		t.Fatal(err)
	}
	return l
}
func creatorAmount(l *CreatorLedger, epoch, asset string) string {
	for _, b := range l.Snapshot() {
		if b.Epoch == epoch && b.Asset == asset {
			return b.Amount
		}
	}
	panic("missing balance")
}
func TestCreatorEpochIsolation(t *testing.T) {
	l := creatorLedger(t)
	inputs := []Input{
		transactionInput(t, "FeeBucketsCredited", 0, map[string]string{"feeAsset": market.Meme, "creatorEpoch": "1", "creatorAmount": "10"}),
		transactionInput(t, "FeeBucketsCredited", 1, map[string]string{"feeAsset": market.Meme, "creatorEpoch": "2", "creatorAmount": "20"}),
		transactionInput(t, "FeeClaimed", 2, map[string]string{"feeAsset": market.Meme, "beneficiaryType": "0", "beneficiaryEpoch": "1", "amount": "3"}),
		transactionInput(t, "RewardConverted", 3, map[string]string{"creatorEpoch": "2", "memeSpent": "5", "quoteReceived": "7"}),
		transactionInput(t, "HolderFeesAccrued", 4, map[string]string{"feeAsset": market.Meme, "epochId": "1", "amount": "9"}),
		transactionInput(t, "RewardConverted", 5, map[string]string{"creatorEpoch": "0", "memeSpent": "999", "quoteReceived": "999"}),
	}
	if changed, err := l.ApplyTransaction(inputs); err != nil || !changed {
		t.Fatal(changed, err)
	}
	if creatorAmount(l, "1", market.Meme) != "7" || creatorAmount(l, "2", market.Meme) != "15" || creatorAmount(l, "1", market.Quote) != "0" || creatorAmount(l, "2", market.Quote) != "7" {
		t.Fatal(l.Snapshot())
	}
	// Curve credits go only to their declared epoch and quote asset.
	if _, err := l.ApplyTransaction([]Input{transactionInput(t, "CurveFeesSwept", 0, map[string]string{"creatorEpoch": "1", "quoteAsset": market.Quote, "creatorAmount": "9007199254740993"})}); err != nil {
		t.Fatal(err)
	}
	if creatorAmount(l, "1", market.Quote) != "9007199254740993" || creatorAmount(l, "2", market.Quote) != "7" {
		t.Fatal(l.Snapshot())
	}
}
func TestCreatorEpochAtomicRejection(t *testing.T) {
	for _, mode := range []string{"wrong epoch", "epoch underflow", "wrong asset", "overflow", "wrong emitter", "duplicate"} {
		t.Run(mode, func(t *testing.T) {
			l := creatorLedger(t)
			if _, err := l.ApplyTransaction([]Input{transactionInput(t, "FeeBucketsCredited", 0, map[string]string{"creatorEpoch": "2", "feeAsset": market.Meme, "creatorAmount": "20"})}); err != nil {
				t.Fatal(err)
			}
			first := transactionInput(t, "CurveFeesSwept", 0, map[string]string{"creatorEpoch": "1", "quoteAsset": market.Quote, "creatorAmount": "1"})
			second := transactionInput(t, "FeeClaimed", 1, map[string]string{"beneficiaryType": "0", "beneficiaryEpoch": "1", "feeAsset": market.Meme, "amount": "1"})
			switch mode {
			case "wrong epoch":
				second = transactionInput(t, "FeeBucketsCredited", 1, map[string]string{"creatorEpoch": "3", "feeAsset": market.Meme, "creatorAmount": "1"})
			case "wrong asset":
				second = transactionInput(t, "CurveFeesSwept", 1, map[string]string{"creatorEpoch": "1", "quoteAsset": market.Meme, "creatorAmount": "1"})
			case "overflow":
				second = transactionInput(t, "FeeBucketsCredited", 1, map[string]string{"creatorEpoch": "1", "feeAsset": market.Quote, "creatorAmount": maximum.String()})
			case "wrong emitter":
				second.Log.Address = market.Distributor
			case "duplicate":
				second.Log.LogIndex = first.Log.LogIndex
			}
			before := l.Snapshot()
			if changed, err := l.ApplyTransaction([]Input{first, second}); err == nil || changed || !reflect.DeepEqual(before, l.Snapshot()) {
				t.Fatal("partial epoch update", changed, err)
			}
		})
	}
}
func TestCreatorEpochConversionOrder(t *testing.T) {
	l := creatorLedger(t)
	credit := func(index int, amount string) Input {
		return transactionInput(t, "FeeBucketsCredited", index, map[string]string{"creatorEpoch": "1", "feeAsset": market.Meme, "creatorAmount": amount})
	}
	if _, err := l.ApplyTransaction([]Input{credit(0, maximum.String())}); err != nil {
		t.Fatal(err)
	}
	if _, err := l.ApplyTransaction([]Input{credit(0, "1"), transactionInput(t, "RewardConverted", 1, map[string]string{"creatorEpoch": "1", "memeSpent": "2", "quoteReceived": "1"})}); err != nil {
		t.Fatal(err)
	}
	if creatorAmount(l, "1", market.Meme) != new(big.Int).Sub(maximum, big.NewInt(1)).String() {
		t.Fatal(l.Snapshot())
	}
}
func TestCreatorEpochConfiguration(t *testing.T) {
	for _, mode := range []string{"zero epoch", "noncanonical", "duplicate", "asset mismatch"} {
		t.Run(mode, func(t *testing.T) {
			e := CreatorEpoch{MarketID: market.ID, Epoch: "1", Meme: market.Meme, Quote: market.Quote}
			entries := []CreatorEpoch{e}
			switch mode {
			case "zero epoch":
				entries[0].Epoch = "0"
			case "noncanonical":
				entries[0].Epoch = "01"
			case "duplicate":
				entries = append(entries, e)
			case "asset mismatch":
				e.Epoch = "2"
				e.Quote = market.Distributor
				entries = append(entries, e)
			}
			if _, err := NewCreatorLedger(vault, entries); err == nil {
				t.Fatal("invalid configuration")
			}
		})
	}
}
