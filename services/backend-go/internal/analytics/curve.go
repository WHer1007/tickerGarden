// Package analytics derives display analytics from already authenticated events.
// It does not authenticate emitters, identify end-user wallets, or settle funds.
package analytics

import (
	"errors"
	"math/big"
	"regexp"

	"tickergarden/backend/internal/events"
)

var uintRE = regexp.MustCompile(`^(0|[1-9][0-9]{0,77})$`)
var errCurve = errors.New("invalid curve trade amounts")

// CurveAmounts preserves the event's cash flow and the curve-only consideration.
// TaxRaw combines anti-snipe and creator tax exactly as the event does; it must
// not be relabelled as creator revenue. Refund events are not additional trades.
type CurveAmounts struct {
	Side             string `json:"side"`
	MemeRaw          string `json:"memeRaw"`
	QuoteCashFlowRaw string `json:"quoteCashFlowRaw"`
	QuoteCurveRaw    string `json:"quoteCurveRaw"`
	FeeRaw           string `json:"feeRaw"`
	TaxRaw           string `json:"taxRaw"`
	// Reduced rational QUOTE_PER_WHOLE_MEME, excluding fee and tax.
	PriceNumerator   string `json:"priceNumerator"`
	PriceDenominator string `json:"priceDenominator"`
	PriceUnit        string `json:"priceUnit"`
}

func uint256(v any) (*big.Int, error) {
	s, ok := v.(string)
	if !ok {
		return nil, errCurve
	}
	n := new(big.Int)
	if err := setUint256(n, s); err != nil {
		return nil, err
	}
	return n, nil
}

// setUint256 permits reuse of scratch storage in bounded aggregation loops.
// Callers must not retain dst as an input value or use it after an error.
func setUint256(dst *big.Int, s string) error {
	if !uintRE.MatchString(s) {
		return errCurve
	}
	if _, ok := dst.SetString(s, 10); !ok || dst.BitLen() > 256 {
		return errCurve
	}
	return nil
}

// NormalizeCurveAmounts is an amount normalization step only. A CurveSell may
// be an internal reward conversion; callers must classify transaction evidence
// before adding it to user volume or user-activity records.
func NormalizeCurveAmounts(event events.Decoded, quoteDecimals uint8) (CurveAmounts, error) {
	if event.Module != "TickerGardenCurve" || quoteDecimals < 6 || quoteDecimals > 18 {
		return CurveAmounts{}, errCurve
	}
	side, quoteKey, memeKey := "buy", "quoteIn", "tokensOut"
	switch event.Signature {
	case "CurveBuy(address,address,uint256,uint256,uint256,uint256)":
	case "CurveSell(address,address,uint256,uint256,uint256,uint256)":
		side, quoteKey, memeKey = "sell", "quoteOut", "tokensIn"
	default:
		return CurveAmounts{}, errCurve
	}
	cash, err := uint256(event.Args[quoteKey])
	if err != nil {
		return CurveAmounts{}, err
	}
	meme, err := uint256(event.Args[memeKey])
	if err != nil || meme.Sign() == 0 {
		return CurveAmounts{}, errCurve
	}
	fee, err := uint256(event.Args["fee"])
	if err != nil {
		return CurveAmounts{}, err
	}
	tax, err := uint256(event.Args["tax"])
	if err != nil {
		return CurveAmounts{}, err
	}
	fees := new(big.Int).Add(fee, tax)
	consideration := new(big.Int).Set(cash)
	if side == "buy" {
		consideration.Sub(consideration, fees)
	} else {
		consideration.Add(consideration, fees)
	}
	if cash.Sign() == 0 || consideration.Sign() <= 0 || consideration.BitLen() > 256 {
		return CurveAmounts{}, errCurve
	}
	numerator := new(big.Int).Mul(consideration, new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
	denominator := new(big.Int).Mul(meme, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(quoteDecimals)), nil))
	gcd := new(big.Int).GCD(nil, nil, numerator, denominator)
	numerator.Quo(numerator, gcd)
	denominator.Quo(denominator, gcd)
	return CurveAmounts{Side: side, MemeRaw: meme.String(), QuoteCashFlowRaw: cash.String(), QuoteCurveRaw: consideration.String(), FeeRaw: fee.String(), TaxRaw: tax.String(), PriceNumerator: numerator.String(), PriceDenominator: denominator.String(), PriceUnit: "QUOTE_PER_WHOLE_MEME_EXCLUDING_FEES"}, nil
}
