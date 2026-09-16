package analytics

import (
	"math/big"
	"testing"
	"tickergarden/backend/internal/events"
)

func curveEvent(side string) events.Decoded {
	name, q, m := "CurveBuy", "quoteIn", "tokensOut"
	if side == "sell" {
		name, q, m = "CurveSell", "quoteOut", "tokensIn"
	}
	return events.Decoded{Module: "TickerGardenCurve", Signature: name + "(address,address,uint256,uint256,uint256,uint256)", Args: map[string]any{q: "1000000", m: "2000000000000000000", "fee": "10000", "tax": "20000"}}
}
func TestCurveCashFlowAndExecutionPrice(t *testing.T) {
	for _, tc := range []struct{ side, consideration, num, den string }{{"buy", "970000", "97", "200"}, {"sell", "1030000", "103", "200"}} {
		got, err := NormalizeCurveAmounts(curveEvent(tc.side), 6)
		if err != nil || got.QuoteCashFlowRaw != "1000000" || got.QuoteCurveRaw != tc.consideration || got.PriceNumerator != tc.num || got.PriceDenominator != tc.den {
			t.Fatalf("%+v %v", got, err)
		}
	}
}
func TestCurveAmountsRejectImpossibleInputs(t *testing.T) {
	for _, mutate := range []func(*events.Decoded){
		func(e *events.Decoded) { e.Module = "ProtocolFeeVault" },
		func(e *events.Decoded) { e.Signature = "CurveBuyRefunded(address,uint256)" },
		func(e *events.Decoded) { e.Args["quoteIn"] = "1e6" },
		func(e *events.Decoded) { e.Args["tokensOut"] = "0" },
		func(e *events.Decoded) { e.Args["fee"] = "1000001" },
		func(e *events.Decoded) { delete(e.Args, "tax") },
		func(e *events.Decoded) { e.Args["quoteIn"] = float64(1000000) },
	} {
		e := curveEvent("buy")
		mutate(&e)
		if _, err := NormalizeCurveAmounts(e, 6); err == nil {
			t.Fatal("invalid trade accepted")
		}
	}
	e := curveEvent("sell")
	e.Args["quoteOut"] = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)).String()
	if _, err := NormalizeCurveAmounts(e, 18); err == nil {
		t.Fatal("overflow accepted")
	}
	if _, err := NormalizeCurveAmounts(curveEvent("buy"), 5); err == nil {
		t.Fatal("invalid decimals")
	}
}
func TestCurveAmountsPreserveLargeIntegers(t *testing.T) {
	e := curveEvent("buy")
	e.Args["quoteIn"] = "9007199254740993000000000000000000"
	e.Args["fee"] = "0"
	e.Args["tax"] = "0"
	got, err := NormalizeCurveAmounts(e, 18)
	if err != nil || got.PriceNumerator != "9007199254740993" || got.PriceDenominator != "2" {
		t.Fatalf("%+v %v", got, err)
	}
}
