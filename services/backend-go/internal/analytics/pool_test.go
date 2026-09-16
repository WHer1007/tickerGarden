package analytics

import (
	"fmt"
	"strings"
	"testing"
	"tickergarden/backend/internal/events"
)

func poolFixture(buy, memeFirst bool) (events.Decoded, events.Decoded, PoolBinding) {
	a, z := "0x"+strings.Repeat("1", 40), "0x"+strings.Repeat("2", 40)
	b := PoolBinding{MarketID: "0x" + strings.Repeat("3", 64), PoolID: "0x" + strings.Repeat("4", 64), Currency0: a, Currency1: z, MemeAsset: a, QuoteAsset: z, QuoteDecimals: 18}
	m, q := "1000", "-10000"
	if !buy {
		m, q = "-1000", "10000"
	}
	x, y := m, q
	if !memeFirst {
		b.MemeAsset, b.QuoteAsset = z, a
		x, y = q, m
	}
	swap := events.Decoded{Module: "UniswapV4PoolManager", Signature: "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)", Args: map[string]any{"id": b.PoolID, "amount0": x, "amount1": y, "fee": "0"}}
	fee := events.Decoded{Module: "TickerGardenMemeHook", Signature: "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)", Args: map[string]any{"marketId": b.MarketID, "poolId": b.PoolID, "feeAsset": b.MemeAsset, "base": "1000", "totalFee": "100", "lpAmount": "0", "nonLpAmount": "100"}}
	return swap, fee, b
}
func TestPoolSignsOrderingAndHookFees(t *testing.T) {
	for _, buy := range []bool{true, false} {
		for _, first := range []bool{true, false} {
			for _, quoteFee := range []bool{true, false} {
				t.Run(fmt.Sprint(buy, first, quoteFee), func(t *testing.T) {
					swap, fee, b := poolFixture(buy, first)
					if quoteFee {
						fee.Args["feeAsset"] = b.QuoteAsset
						fee.Args["base"] = "10000"
					}
					r, e := NormalizePoolAmounts(swap, &fee, b)
					if e != nil {
						t.Fatal(e)
					}
					m, q := "1000", "-10000"
					side := "buy"
					if !buy {
						m, q, side = "-1000", "10000", "sell"
					}
					if quoteFee {
						if buy {
							q = "-10100"
						} else {
							q = "9900"
						}
					} else {
						if buy {
							m = "900"
						} else {
							m = "-1100"
						}
					}
					if r.Side != side || r.MemeCoreRaw != "1000" || r.QuoteCoreRaw != "10000" || r.PriceNumerator != "10" || r.PriceDenominator != "1" || *r.MemeCallerDelta != m || *r.QuoteCallerDelta != q {
						t.Fatal(r)
					}
				})
			}
		}
	}
}
func TestPoolMissingFeeIsNotZero(t *testing.T) {
	s, _, b := poolFixture(true, true)
	r, e := NormalizePoolAmounts(s, nil, b)
	if e != nil || r.FeeRaw != nil || r.MemeCallerDelta != nil || r.QuoteCallerDelta != nil || r.FeeStatus != "not_provided" {
		t.Fatal(r, e)
	}
}
func TestPoolRejectsMismatch(t *testing.T) {
	for _, mode := range []string{"direction", "corefee", "overflow", "pool", "asset", "base", "split", "excess"} {
		s, f, b := poolFixture(true, true)
		switch mode {
		case "direction":
			s.Args["amount1"] = "10000"
		case "corefee":
			s.Args["fee"] = "1"
		case "overflow":
			s.Args["amount0"] = "170141183460469231731687303715884105728"
		case "pool":
			f.Args["poolId"] = b.MarketID
		case "asset":
			f.Args["feeAsset"] = "0x" + strings.Repeat("f", 40)
		case "base":
			f.Args["base"] = "1"
		case "split":
			f.Args["lpAmount"] = "100"
		case "excess":
			f.Args["totalFee"] = "1000"
			f.Args["nonLpAmount"] = "1000"
		}
		if _, e := NormalizePoolAmounts(s, &f, b); e == nil {
			t.Fatal(mode)
		}
	}
}
