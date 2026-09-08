package feeledger

import (
	"math/big"
	"reflect"
	"testing"
)

func holderLedger(t *testing.T, continuous bool) *HolderLedger {
	t.Helper()
	e := HolderEpoch{MarketID: market.ID, Epoch: "1", Meme: market.Meme, Quote: market.Quote, Distributor: market.Distributor, DistributorModule: "TreasuryDistributorV1"}
	entries := []HolderEpoch{e}
	if continuous {
		entries[0].DistributorModule = "HolderRewardsDistributorV1"
	} else {
		e.Epoch = "2"
		entries = append(entries, e)
	}
	l, err := NewHolderLedger(vault, entries)
	if err != nil {
		t.Fatal(err)
	}
	return l
}
func holderInput(t *testing.T, name string, index int, values map[string]string) Input {
	t.Helper()
	in := transactionInput(t, name, index, values)
	switch name {
	case "QuoteTreasuryFunded", "TreasuryClaimed":
		in.Module = "TreasuryDistributorV1"
		in.Log.Address = market.Distributor
	case "HolderStreamFunded", "HolderStreamClaimed":
		in.Module = "HolderRewardsDistributorV1"
		in.Log.Address = market.Distributor
	}
	return in
}
func holderAmount(l *HolderLedger, epoch, asset string) string {
	for _, b := range l.Snapshot() {
		if b.Epoch == epoch && b.Asset == asset {
			return b.Amount
		}
	}
	panic("missing Holder balance")
}
func TestHolderEpochFlows(t *testing.T) {
	l := holderLedger(t, false)
	inputs := []Input{
		holderInput(t, "HolderFeesAccrued", 0, map[string]string{"epochId": "1", "feeAsset": market.Meme, "amount": "10"}),
		holderInput(t, "HolderFeesAccrued", 1, map[string]string{"epochId": "2", "feeAsset": market.Meme, "amount": "20"}),
		holderInput(t, "HolderRewardsConverted", 2, map[string]string{"epochId": "1", "memeAsset": market.Meme, "quoteAsset": market.Quote, "memeSpent": "4", "quoteReceived": "6"}),
		holderInput(t, "QuoteTreasuryFunded", 3, map[string]string{"epochId": "1", "funder": vault, "quoteToken": market.Quote, "amount": "6"}),
		holderInput(t, "HolderFeesAccrued", 4, map[string]string{"epochId": "2", "feeAsset": market.Quote, "amount": "9007199254740993"}),
		holderInput(t, "QuoteTreasuryFunded", 5, map[string]string{"epochId": "2", "funder": market.Distributor, "quoteToken": market.Quote, "amount": "999"}),
		holderInput(t, "TreasuryClaimed", 6, map[string]string{"epochId": "1", "amount": "6"}),
	}
	if changed, err := l.ApplyTransaction(inputs); err != nil || !changed {
		t.Fatal(changed, err)
	}
	if holderAmount(l, "1", market.Meme) != "6" || holderAmount(l, "1", market.Quote) != "0" || holderAmount(l, "2", market.Meme) != "20" || holderAmount(l, "2", market.Quote) != "9007199254740993" {
		t.Fatal(l.Snapshot())
	}
}
func TestHolderContinuousFunding(t *testing.T) {
	l := holderLedger(t, true)
	inputs := []Input{
		holderInput(t, "HolderFeesAccrued", 0, map[string]string{"epochId": "1", "feeAsset": market.Quote, "amount": "10"}),
		holderInput(t, "HolderStreamFunded", 1, map[string]string{"amount": "10", "end": "86400"}),
		holderInput(t, "HolderStreamClaimed", 2, map[string]string{"amount": "10", "asset": market.Quote}),
	}
	if _, err := l.ApplyTransaction(inputs); err != nil || holderAmount(l, "1", market.Quote) != "0" {
		t.Fatal(err, l.Snapshot())
	}
	if _, err := NewHolderLedger(vault, []HolderEpoch{{MarketID: market.ID, Epoch: "2", Meme: market.Meme, Quote: market.Quote, Distributor: market.Distributor, DistributorModule: "HolderRewardsDistributorV1"}}); err == nil {
		t.Fatal("continuous epoch other than 1")
	}
}
func TestHolderAtomicRejection(t *testing.T) {
	for _, mode := range []string{"epoch underflow", "unknown epoch", "wrong distributor", "wrong module", "wrong quote", "overflow"} {
		t.Run(mode, func(t *testing.T) {
			l := holderLedger(t, false)
			seed := holderInput(t, "HolderFeesAccrued", 0, map[string]string{"epochId": "2", "feeAsset": market.Quote, "amount": "10"})
			if _, err := l.ApplyTransaction([]Input{seed}); err != nil {
				t.Fatal(err)
			}
			first := holderInput(t, "HolderFeesAccrued", 0, map[string]string{"epochId": "1", "feeAsset": market.Meme, "amount": "1"})
			second := holderInput(t, "QuoteTreasuryFunded", 1, map[string]string{"epochId": "1", "funder": vault, "quoteToken": market.Quote, "amount": "1"})
			switch mode {
			case "unknown epoch":
				second = holderInput(t, "HolderFeesAccrued", 1, map[string]string{"epochId": "3", "feeAsset": market.Quote, "amount": "1"})
			case "wrong distributor":
				second.Log.Address = vault
			case "wrong module":
				second.Module = "HolderRewardsDistributorV1"
			case "wrong quote":
				second = holderInput(t, "HolderRewardsConverted", 1, map[string]string{"epochId": "1", "memeAsset": market.Meme, "quoteAsset": market.Meme, "memeSpent": "1", "quoteReceived": "2"})
			case "overflow":
				second = holderInput(t, "HolderFeesAccrued", 1, map[string]string{"epochId": "1", "feeAsset": market.Meme, "amount": maximum.String()})
			}
			before := l.Snapshot()
			if changed, err := l.ApplyTransaction([]Input{first, second}); err == nil || changed || !reflect.DeepEqual(before, l.Snapshot()) {
				t.Fatal("partial Holder state", changed, err)
			}
		})
	}
}
func TestHolderConversionOrder(t *testing.T) {
	l := holderLedger(t, false)
	credit := func(n string) Input {
		return holderInput(t, "HolderFeesAccrued", 0, map[string]string{"epochId": "1", "feeAsset": market.Meme, "amount": n})
	}
	if _, err := l.ApplyTransaction([]Input{credit(maximum.String())}); err != nil {
		t.Fatal(err)
	}
	conversion := holderInput(t, "HolderRewardsConverted", 1, map[string]string{"epochId": "1", "memeAsset": market.Meme, "quoteAsset": market.Quote, "memeSpent": "2", "quoteReceived": "1"})
	if _, err := l.ApplyTransaction([]Input{credit("1"), conversion}); err != nil {
		t.Fatal(err)
	}
	if holderAmount(l, "1", market.Meme) != new(big.Int).Sub(maximum, big.NewInt(1)).String() {
		t.Fatal(l.Snapshot())
	}
}
