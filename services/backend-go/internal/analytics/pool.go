package analytics

import (
	"errors"
	"math/big"
	"regexp"
	"strings"

	"tickergarden/backend/internal/events"
)

var errPool = errors.New("invalid bound pool trade")
var signedRE = regexp.MustCompile(`^(0|-?[1-9][0-9]{0,38})$`)

type PoolBinding struct {
	MarketID, PoolID, Currency0, Currency1, MemeAsset, QuoteAsset string
	QuoteDecimals                                                 uint8
}
type PoolAmounts struct {
	Side             string  `json:"side"`
	MemeCoreRaw      string  `json:"memeCoreRaw"`
	QuoteCoreRaw     string  `json:"quoteCoreRaw"`
	MemeCallerDelta  *string `json:"memeCallerDelta"`
	QuoteCallerDelta *string `json:"quoteCallerDelta"`
	FeeAsset         string  `json:"feeAsset,omitempty"`
	FeeRaw           *string `json:"feeRaw"`
	FeeStatus        string  `json:"feeStatus"`
	PriceNumerator   string  `json:"priceNumerator"`
	PriceDenominator string  `json:"priceDenominator"`
	PriceUnit        string  `json:"priceUnit"`
}

func int128(v any) (*big.Int, error) {
	s, ok := v.(string)
	if !ok || !signedRE.MatchString(s) {
		return nil, errPool
	}
	n, ok := new(big.Int).SetString(s, 10)
	min := new(big.Int).Neg(new(big.Int).Lsh(big.NewInt(1), 127))
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 127), big.NewInt(1))
	if !ok || n.Cmp(min) < 0 || n.Cmp(max) > 0 {
		return nil, errPool
	}
	return n, nil
}

// NormalizePoolAmounts requires authenticated canonical binding and, if supplied,
// the uniquely paired V4FeeAccrued event. It does not associate events by itself.
// The pool sender may be a router; these are caller deltas, not wallet balances.
func NormalizePoolAmounts(swap events.Decoded, fee *events.Decoded, b PoolBinding) (PoolAmounts, error) {
	if swap.Module != "UniswapV4PoolManager" || swap.Signature != "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)" || !hashRE.MatchString(b.PoolID) || !hashRE.MatchString(b.MarketID) || swap.Args["id"] != b.PoolID || !addressRE.MatchString(b.Currency0) || !addressRE.MatchString(b.Currency1) || b.Currency0 >= b.Currency1 || b.QuoteDecimals < 6 || b.QuoteDecimals > 18 {
		return PoolAmounts{}, errPool
	}
	if b.MemeAsset == "0x"+strings.Repeat("0", 40) || !((b.MemeAsset == b.Currency0 && b.QuoteAsset == b.Currency1) || (b.MemeAsset == b.Currency1 && b.QuoteAsset == b.Currency0)) || (b.QuoteAsset == "0x"+strings.Repeat("0", 40) && b.QuoteDecimals != 18) {
		return PoolAmounts{}, errPool
	}
	coreFee, err := uint256(swap.Args["fee"])
	if err != nil || coreFee.Sign() != 0 {
		return PoolAmounts{}, errPool
	}
	a0, err := int128(swap.Args["amount0"])
	if err != nil {
		return PoolAmounts{}, err
	}
	a1, err := int128(swap.Args["amount1"])
	if err != nil {
		return PoolAmounts{}, err
	}
	if a0.Sign()*a1.Sign() != -1 {
		return PoolAmounts{}, errPool
	}
	meme, quote := a0, a1
	if b.MemeAsset == b.Currency1 {
		meme, quote = a1, a0
	}
	side := "buy"
	if meme.Sign() < 0 {
		side = "sell"
	}
	m, q := new(big.Int).Abs(meme), new(big.Int).Abs(quote)
	ratio := new(big.Rat).SetFrac(new(big.Int).Mul(q, new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)), new(big.Int).Mul(m, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(b.QuoteDecimals)), nil)))
	out := PoolAmounts{Side: side, MemeCoreRaw: m.String(), QuoteCoreRaw: q.String(), FeeStatus: "not_provided", PriceNumerator: ratio.Num().String(), PriceDenominator: ratio.Denom().String(), PriceUnit: "QUOTE_PER_WHOLE_MEME_CORE"}
	if fee == nil {
		return out, nil
	}
	if fee.Module != "TickerGardenMemeHook" || fee.Signature != "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)" || fee.Args["marketId"] != b.MarketID || fee.Args["poolId"] != b.PoolID {
		return PoolAmounts{}, errPool
	}
	asset, ok := fee.Args["feeAsset"].(string)
	if !ok || (asset != b.MemeAsset && asset != b.QuoteAsset) {
		return PoolAmounts{}, errPool
	}
	total, e := uint256(fee.Args["totalFee"])
	if e != nil || total.Sign() == 0 || total.BitLen() > 127 {
		return PoolAmounts{}, errPool
	}
	base, e := uint256(fee.Args["base"])
	if e != nil {
		return PoolAmounts{}, errPool
	}
	expected := q
	if asset == b.MemeAsset {
		expected = m
	}
	if base.Cmp(expected) != 0 {
		return PoolAmounts{}, errPool
	}
	lp, e := uint256(fee.Args["lpAmount"])
	if e != nil {
		return PoolAmounts{}, errPool
	}
	non, e := uint256(fee.Args["nonLpAmount"])
	if e != nil || new(big.Int).Add(lp, non).Cmp(total) != 0 {
		return PoolAmounts{}, errPool
	}
	mc, qc := new(big.Int).Set(meme), new(big.Int).Set(quote)
	if asset == b.MemeAsset {
		mc.Sub(mc, total)
	} else {
		qc.Sub(qc, total)
	}
	ms, qs := mc.String(), qc.String()
	if _, e = int128(ms); e != nil {
		return PoolAmounts{}, errPool
	}
	if _, e = int128(qs); e != nil {
		return PoolAmounts{}, errPool
	}
	if mc.Sign() != meme.Sign() || qc.Sign() != quote.Sign() {
		return PoolAmounts{}, errPool
	}
	f := total.String()
	out.MemeCallerDelta = &ms
	out.QuoteCallerDelta = &qs
	out.FeeAsset = asset
	out.FeeRaw = &f
	out.FeeStatus = "paired_event"
	return out, nil
}
