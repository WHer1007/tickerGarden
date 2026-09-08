package feeledger

import (
	"reflect"
	"testing"
)

func treasuryLedger(t *testing.T) *TreasuryLedger {
	t.Helper()
	l, err := NewTreasuryLedger([]TreasuryEpoch{{MarketID: market.ID, Epoch: "1", Quote: market.Quote, Distributor: market.Distributor}, {MarketID: market.ID, Epoch: "2", Quote: market.Quote, Distributor: market.Distributor}})
	if err != nil {
		t.Fatal(err)
	}
	return l
}
func treasuryInput(t *testing.T, name string, index int, values map[string]string) Input {
	t.Helper()
	in := transactionInput(t, name, index, values)
	in.Module = "TreasuryDistributorV1"
	in.Log.Address = market.Distributor
	return in
}
func treasuryEpoch(l *TreasuryLedger, epoch string) TreasuryBalance {
	for _, b := range l.Snapshot() {
		if b.Epoch == epoch {
			return b
		}
	}
	panic("missing Treasury epoch")
}
func TestTreasuryFundingClaimsRollover(t *testing.T) {
	l := treasuryLedger(t)
	inputs := []Input{
		treasuryInput(t, "QuoteTreasuryFunded", 0, map[string]string{"epochId": "1", "quoteToken": market.Quote, "funder": vault, "amount": "10"}),
		treasuryInput(t, "QuoteTreasuryFunded", 1, map[string]string{"epochId": "1", "quoteToken": market.Quote, "funder": market.Meme, "amount": "5"}),
		treasuryInput(t, "TreasuryClaimed", 2, map[string]string{"epochId": "1", "amount": "4"}),
		treasuryInput(t, "QuoteTreasuryFunded", 3, map[string]string{"epochId": "2", "quoteToken": market.Quote, "amount": "2"}),
		treasuryInput(t, "EpochRemainderRolledOver", 4, map[string]string{"fromEpochId": "1", "toEpochId": "2", "amount": "11"}),
		treasuryInput(t, "TreasuryClaimed", 5, map[string]string{"epochId": "2", "amount": "3"}),
	}
	if changed, err := l.ApplyTransaction(inputs); err != nil || !changed {
		t.Fatal(changed, err)
	}
	a, b := treasuryEpoch(l, "1"), treasuryEpoch(l, "2")
	if a.Funded != "0" || a.Claimed != "4" || a.Outstanding != "0" || !a.RolledOver || b.Funded != "13" || b.Claimed != "3" || b.Outstanding != "10" || b.RolledOver {
		t.Fatal(l.Snapshot())
	}
	before := l.Snapshot()
	if _, err := l.ApplyTransaction([]Input{treasuryInput(t, "EpochRemainderRolledOver", 0, map[string]string{"fromEpochId": "1", "toEpochId": "2", "amount": "0"})}); err == nil || !reflect.DeepEqual(before, l.Snapshot()) {
		t.Fatal("second rollover changed history")
	}
}
func TestTreasuryZeroRemainder(t *testing.T) {
	l := treasuryLedger(t)
	if _, err := l.ApplyTransaction([]Input{
		treasuryInput(t, "QuoteTreasuryFunded", 0, map[string]string{"epochId": "1", "quoteToken": market.Quote, "amount": "5"}),
		treasuryInput(t, "TreasuryClaimed", 1, map[string]string{"epochId": "1", "amount": "5"}),
		treasuryInput(t, "EpochRemainderRolledOver", 2, map[string]string{"fromEpochId": "1", "toEpochId": "2", "amount": "0"}),
	}); err != nil {
		t.Fatal(err)
	}
	if a := treasuryEpoch(l, "1"); a.Claimed != "5" || a.Funded != "0" || !a.RolledOver {
		t.Fatal(a)
	}
}
func TestTreasuryAtomicRejection(t *testing.T) {
	for _, mode := range []string{"underflow", "wrong remainder", "backward rollover", "unknown epoch", "wrong quote", "wrong emitter", "aggregate overflow", "duplicate"} {
		t.Run(mode, func(t *testing.T) {
			l := treasuryLedger(t)
			first := treasuryInput(t, "QuoteTreasuryFunded", 0, map[string]string{"epochId": "1", "quoteToken": market.Quote, "amount": "5"})
			second := treasuryInput(t, "TreasuryClaimed", 1, map[string]string{"epochId": "1", "amount": "6"})
			switch mode {
			case "wrong remainder":
				second = treasuryInput(t, "EpochRemainderRolledOver", 1, map[string]string{"fromEpochId": "1", "toEpochId": "2", "amount": "4"})
			case "backward rollover":
				second = treasuryInput(t, "EpochRemainderRolledOver", 1, map[string]string{"fromEpochId": "2", "toEpochId": "1", "amount": "0"})
			case "unknown epoch":
				second = treasuryInput(t, "QuoteTreasuryFunded", 1, map[string]string{"epochId": "3", "quoteToken": market.Quote, "amount": "1"})
			case "wrong quote":
				second = treasuryInput(t, "QuoteTreasuryFunded", 1, map[string]string{"epochId": "2", "quoteToken": market.Meme, "amount": "1"})
			case "wrong emitter":
				second.Log.Address = vault
			case "aggregate overflow":
				second = treasuryInput(t, "QuoteTreasuryFunded", 1, map[string]string{"epochId": "2", "quoteToken": market.Quote, "amount": maximum.String()})
			case "duplicate":
				second.Log.LogIndex = first.Log.LogIndex
			}
			before := l.Snapshot()
			if changed, err := l.ApplyTransaction([]Input{first, second}); err == nil || changed || !reflect.DeepEqual(before, l.Snapshot()) {
				t.Fatal("partial Treasury ledger", changed, err)
			}
		})
	}
}
