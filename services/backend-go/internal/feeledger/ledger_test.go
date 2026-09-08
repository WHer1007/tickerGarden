package feeledger

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

var vault = "0x" + strings.Repeat("1", 40)
var market = Market{ID: "0x" + strings.Repeat("2", 64), Meme: "0x" + strings.Repeat("3", 40), Quote: zero, Distributor: "0x" + strings.Repeat("4", 40), DistributorModule: "TreasuryDistributorV1"}

func newLedger(t *testing.T) *Ledger {
	t.Helper()
	l, e := New(vault, []Market{market})
	if e != nil {
		t.Fatal(e)
	}
	return l
}
func apply(t *testing.T, l *Ledger, name string, args map[string]any) {
	t.Helper()
	args["marketId"] = market.ID
	if _, e := l.apply("ProtocolFeeVault", vault, name, args); e != nil {
		t.Fatal(name, e)
	}
}
func balance(l *Ledger, asset string) [5]string {
	for _, b := range l.Snapshot() {
		if b.Asset == asset {
			return b.Buckets
		}
	}
	panic("missing asset")
}
func TestFeeCreditForfeitureClaimAndConversion(t *testing.T) {
	l := newLedger(t)
	apply(t, l, "HolderFeesAccrued", map[string]any{"feeAsset": market.Meme, "amount": "5"})
	apply(t, l, "FeeBucketsCredited", map[string]any{"feeAsset": market.Meme, "creatorAmount": "15", "stakerAmount": "30", "platformAmount": "10"})
	apply(t, l, "ForfeitureReserved", map[string]any{"feeAsset": market.Meme, "amount": "7", "reserveBalance": "7"})
	apply(t, l, "ForfeitureReserveConverted", map[string]any{"feeAsset": market.Meme, "amount": "7"})
	apply(t, l, "FeeClaimed", map[string]any{"feeAsset": market.Meme, "beneficiaryType": "2", "amount": "2"})
	apply(t, l, "RewardConverted", map[string]any{"creatorEpoch": "0", "memeSpent": "3", "quoteReceived": "9"})
	apply(t, l, "HolderRewardsConverted", map[string]any{"memeAsset": market.Meme, "quoteAsset": market.Quote, "memeSpent": "2", "quoteReceived": "6"})
	before := l.Snapshot()
	if changed, e := l.apply("ProtocolFeeVault", vault, "RewardBatchConverted", nil); e != nil || changed || !reflect.DeepEqual(before, l.Snapshot()) {
		t.Fatal("batch double counted")
	}
	if b := balance(l, market.Meme); b != [5]string{"15", "20", "15", "3", "0"} {
		t.Fatal(b)
	}
	if b := balance(l, market.Quote); b != [5]string{"0", "9", "0", "6", "0"} {
		t.Fatal(b)
	}
	_, e := l.apply(market.DistributorModule, market.Distributor, "QuoteTreasuryFunded", map[string]any{"marketId": market.ID, "quoteToken": zero, "funder": vault, "amount": "6"})
	if e != nil || balance(l, zero)[3] != "0" {
		t.Fatal(e)
	}
	before = l.Snapshot()
	if changed, e := l.apply(market.DistributorModule, market.Distributor, "QuoteTreasuryFunded", map[string]any{"marketId": market.ID, "funder": market.Distributor, "amount": "99"}); e != nil || changed || !reflect.DeepEqual(before, l.Snapshot()) {
		t.Fatal("external funding debited FeeVault")
	}
}
func TestFeeLedgerRejectsAtomically(t *testing.T) {
	for _, mode := range []string{"underflow", "reserve mismatch", "overflow", "wrong emitter", "wrong conversion asset", "partial reserve"} {
		t.Run(mode, func(t *testing.T) {
			l := newLedger(t)
			apply(t, l, "FeeBucketsCredited", map[string]any{"feeAsset": market.Meme, "creatorAmount": "1", "stakerAmount": "10", "platformAmount": "1"})
			apply(t, l, "ForfeitureReserved", map[string]any{"feeAsset": market.Meme, "amount": "4", "reserveBalance": "4"})
			before := l.Snapshot()
			name := "FeeClaimed"
			emitter := vault
			args := map[string]any{"marketId": market.ID, "feeAsset": market.Meme, "beneficiaryType": "0", "amount": "2"}
			switch mode {
			case "reserve mismatch":
				name = "ForfeitureReserved"
				args["amount"] = "1"
				args["reserveBalance"] = "9"
			case "overflow":
				name = "FeeBucketsCredited"
				args["creatorAmount"] = "0"
				args["stakerAmount"] = "0"
				args["platformAmount"] = maximum.String()
			case "wrong emitter":
				emitter = market.Distributor
			case "wrong conversion asset":
				name = "HolderRewardsConverted"
				args["memeAsset"] = zero
				args["quoteAsset"] = market.Meme
			case "partial reserve":
				name = "ForfeitureReserveConverted"
				args["amount"] = "3"
			}
			if _, e := l.apply("ProtocolFeeVault", emitter, name, args); e == nil || !reflect.DeepEqual(before, l.Snapshot()) {
				t.Fatal("invalid event changed balances", e)
			}
		})
	}
}
func TestFeeLedgerDecodesCanonicalCredit(t *testing.T) {
	raw, e := os.ReadFile("../projection/testdata/golden.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures []struct{ Input projection.Input }
	if json.Unmarshal(raw, &fixtures) != nil {
		t.Fatal("fixtures")
	}
	for _, fixture := range fixtures {
		in := fixture.Input
		d, e := events.Decode(in.Module, in.Log)
		if e != nil || !strings.HasPrefix(d.Signature, "FeeBucketsCredited(") {
			continue
		}
		m := market
		m.ID = d.Args["marketId"].(string)
		m.Quote = d.Args["feeAsset"].(string)
		if m.Meme == m.Quote {
			m.Meme = "0x" + strings.Repeat("5", 40)
		}
		l, e := New(in.Log.Address, []Market{m})
		if e != nil {
			t.Fatal(e)
		}
		if changed, e := l.Apply(in.Module, in.Log); e != nil || !changed {
			t.Fatal(e)
		}
		b := balance(l, m.Quote)
		if b[0] != d.Args["creatorAmount"] || b[1] != d.Args["stakerAmount"] || b[2] != d.Args["platformAmount"] {
			t.Fatal(b)
		}
		return
	}
	t.Fatal("credit fixture missing")
}

func TestFeeLedgerAggregateAssetOverflow(t *testing.T) {
	second := market
	second.ID = "0x" + strings.Repeat("6", 64)
	l, e := New(vault, []Market{market, second})
	if e != nil {
		t.Fatal(e)
	}
	apply(t, l, "FeeBucketsCredited", map[string]any{"feeAsset": market.Meme, "creatorAmount": maximum.String(), "stakerAmount": "0", "platformAmount": "0"})
	before := l.Snapshot()
	_, e = l.apply("ProtocolFeeVault", vault, "FeeBucketsCredited", map[string]any{"marketId": second.ID, "feeAsset": market.Meme, "creatorAmount": "0", "stakerAmount": "1", "platformAmount": "0"})
	if e == nil || !reflect.DeepEqual(before, l.Snapshot()) {
		t.Fatal("aggregate asset overflow accepted", e)
	}
}
