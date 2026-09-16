package analytics

import "testing"

func TestActivityPreservesEconomicAndIdentityBoundaries(t *testing.T) {
	actor := "0x0000000000000000000000000000000000000001"
	curve := curveActivity(CurveObservation{Actor: actor, Recipient: actor, ActorConfidence: "contract_caller_not_verified_wallet", Classification: "unclassified", Amounts: CurveAmounts{Side: "buy", MemeRaw: "20", QuoteCashFlowRaw: "100", QuoteCurveRaw: "97", FeeRaw: "1", TaxRaw: "2", PriceNumerator: "97", PriceDenominator: "20"}})
	if curve.QuoteRaw != "97" || curve.Actor == nil || *curve.Actor != actor || curve.AmountBasis != "CURVE_EXCLUDING_FEE_TAX" || curve.TaxRaw == nil || *curve.TaxRaw != "2" {
		t.Fatal(curve)
	}
	pool := poolActivity(PoolObservation{Classification: "internal_holder_conversion", Amounts: PoolAmounts{MemeCoreRaw: "20", QuoteCoreRaw: "100", FeeStatus: "not_provided"}})
	if pool.Actor != nil || pool.Recipient != nil || pool.FeeRaw != nil || pool.FeeAsset != nil || pool.TaxRaw != nil || pool.ActorConfidence != "unavailable" || pool.Classification != "internal_holder_conversion" {
		t.Fatal(pool)
	}
}

func TestPoolActivityKeepsSwapCallerWithoutRecipientInference(t *testing.T) {
	caller := "0x0000000000000000000000000000000000000003"
	activity := poolActivity(PoolObservation{Sender: caller, Classification: "internal_reward_conversion"})
	if activity.Actor == nil || *activity.Actor != caller || activity.ActorConfidence != "contract_caller_not_verified_wallet" || activity.Recipient != nil {
		t.Fatal(activity)
	}
}
