package analytics

import (
	"errors"
	"math/big"
	"sort"
	"strconv"
)

var ErrAssetStats = errors.New("inconsistent asset statistics input")

// AssetUID must be bound to the market by authenticated Registry observations.
type AssetMarketTrades struct {
	AssetUID string
	Trades   MarketTrades
}
type AssetFeeTotal struct {
	Asset    string `json:"asset"`
	Decimals uint8  `json:"decimals"`
	FeeRaw   string `json:"feeRaw"`
	TaxRaw   string `json:"taxRaw"`
}
type AssetTradeStats struct {
	AssetUID               string          `json:"assetUid"`
	QuoteAsset             string          `json:"quoteAsset"`
	QuoteDecimals          uint8           `json:"quoteDecimals"`
	MarketCount            uint64          `json:"marketCount"`
	TradingMarketCount     uint64          `json:"tradingMarketCount"`
	TradeCount             uint64          `json:"tradeCount"`
	InternalTradeCount     uint64          `json:"internalTradeCount"`
	UnclassifiedTradeCount uint64          `json:"unclassifiedTradeCount"`
	QuoteVolumeRaw         string          `json:"quoteVolumeRaw"`
	InternalQuoteVolumeRaw string          `json:"internalQuoteVolumeRaw"`
	Fees                   []AssetFeeTotal `json:"fees"`
	UnknownFeeTradeCount   uint64          `json:"unknownFeeTradeCount"`
	VolumeBasis            string          `json:"volumeBasis"`
}

// AggregateAssetTrades groups flows by STOCK identity AND quote currency.
// Different Meme tokens cannot be summed as one quantity. Reserve balances and
// holder counts are not inferred from executions. Fee totals include only
// observed fees; UnknownFeeTradeCount prevents missing fees being called zero.
func AggregateAssetTrades(chain uint64, coverage RangeCoverage, inputs []AssetMarketTrades) ([]AssetTradeStats, error) {
	fail := func() ([]AssetTradeStats, error) { return nil, ErrAssetStats }
	if coverage.From >= coverage.To || len(inputs) > 10000 {
		return fail()
	}
	groups := map[string]*AssetTradeStats{}
	fees := map[string]map[string]*AssetFeeTotal{}
	markets := map[string]bool{}
	seen := map[string]bool{}
	add := func(a, b string) string {
		x, _ := new(big.Int).SetString(a, 10)
		y, _ := new(big.Int).SetString(b, 10)
		return x.Add(x, y).String()
	}
	for _, input := range inputs {
		m := input.Trades
		if !hashRE.MatchString(input.AssetUID) || !hashRE.MatchString(m.MarketID) || !addressRE.MatchString(m.MemeAsset) || !addressRE.MatchString(m.QuoteAsset) || m.MemeAsset == m.QuoteAsset || m.QuoteDecimals < 6 || m.QuoteDecimals > 18 || m.Coverage != coverage || markets[m.MarketID] {
			return fail()
		}
		markets[m.MarketID] = true
		key := input.AssetUID + ":" + m.QuoteAsset
		g := groups[key]
		if g == nil {
			g = &AssetTradeStats{AssetUID: input.AssetUID, QuoteAsset: m.QuoteAsset, QuoteDecimals: m.QuoteDecimals, QuoteVolumeRaw: "0", InternalQuoteVolumeRaw: "0", Fees: []AssetFeeTotal{}, VolumeBasis: "CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE"}
			groups[key] = g
			fees[key] = map[string]*AssetFeeTotal{}
		}
		if g.QuoteDecimals != m.QuoteDecimals {
			return fail()
		}
		g.MarketCount++
		if len(m.Items) > 0 {
			g.TradingMarketCount++
		}
		for _, t := range m.Items {
			if len(seen) >= 100000 || !validSource(t.Source, chain, t.Source.EventKey) || seen[t.Source.EventKey] || t.MarketID != m.MarketID || t.MemeAsset != m.MemeAsset || t.QuoteAsset != m.QuoteAsset || t.QuoteDecimals != m.QuoteDecimals {
				return fail()
			}
			seen[t.Source.EventKey] = true
			ts, e := strconv.ParseUint(t.Timestamp, 10, 64)
			if e != nil || strconv.FormatUint(ts, 10) != t.Timestamp || ts < coverage.From || ts >= coverage.To {
				return fail()
			}
			q, e := uint256(t.QuoteRaw)
			if e != nil || q.Sign() == 0 {
				return fail()
			}
			meme, e := uint256(t.MemeRaw)
			if e != nil || meme.Sign() == 0 {
				return fail()
			}
			if !((t.Venue == "curve" && t.AmountBasis == "CURVE_EXCLUDING_FEE_TAX") || (t.Venue == "pool" && t.AmountBasis == "POOL_CORE")) {
				return fail()
			}
			internal := t.Classification == "internal_reward_conversion" || t.Classification == "internal_holder_conversion"
			if !internal && t.Classification != "unclassified" {
				return fail()
			}
			g.TradeCount++
			g.QuoteVolumeRaw = add(g.QuoteVolumeRaw, t.QuoteRaw)
			if internal {
				g.InternalTradeCount++
				g.InternalQuoteVolumeRaw = add(g.InternalQuoteVolumeRaw, t.QuoteRaw)
			} else {
				g.UnclassifiedTradeCount++
			}
			if t.Venue == "curve" && (internal || t.FeeStatus != "event_reported" || t.TaxRaw == nil || t.FeeAsset == nil || *t.FeeAsset != m.QuoteAsset) {
				return fail()
			}
			if t.Venue == "pool" && (t.TaxRaw != nil || t.FeeStatus == "event_reported") {
				return fail()
			}
			if t.FeeStatus == "not_provided" {
				if t.FeeRaw != nil || t.FeeAsset != nil || t.TaxRaw != nil {
					return fail()
				}
				g.UnknownFeeTradeCount++
				continue
			}
			if (t.FeeStatus != "paired_event" && t.FeeStatus != "event_reported") || t.FeeRaw == nil || t.FeeAsset == nil {
				return fail()
			}
			if _, e = uint256(*t.FeeRaw); e != nil {
				return fail()
			}
			decimals := m.QuoteDecimals
			if *t.FeeAsset == m.MemeAsset {
				decimals = 18
			} else if *t.FeeAsset != m.QuoteAsset {
				return fail()
			}
			fee := fees[key][*t.FeeAsset]
			if fee == nil {
				fee = &AssetFeeTotal{Asset: *t.FeeAsset, Decimals: decimals, FeeRaw: "0", TaxRaw: "0"}
				fees[key][*t.FeeAsset] = fee
			}
			if fee.Decimals != decimals {
				return fail()
			}
			fee.FeeRaw = add(fee.FeeRaw, *t.FeeRaw)
			if t.TaxRaw != nil {
				if _, e = uint256(*t.TaxRaw); e != nil || *t.FeeAsset != m.QuoteAsset {
					return fail()
				}
				fee.TaxRaw = add(fee.TaxRaw, *t.TaxRaw)
			}
		}
	}
	keys := []string{}
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]AssetTradeStats, 0, len(keys))
	for _, key := range keys {
		g := groups[key]
		assets := []string{}
		for asset := range fees[key] {
			assets = append(assets, asset)
		}
		sort.Strings(assets)
		for _, asset := range assets {
			g.Fees = append(g.Fees, *fees[key][asset])
		}
		out = append(out, *g)
	}
	return out, nil
}
