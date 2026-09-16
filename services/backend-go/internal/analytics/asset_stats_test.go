package analytics

import (
	"fmt"
	"testing"
)

func assetStatsFixture() (RangeCoverage, []AssetMarketTrades) {
	r, trades := candleFixture()
	coverage := RangeCoverage{From: 60, To: 120, ProjectionNumber: 10, ProjectionHash: r.MarketID}
	inputs := []AssetMarketTrades{}
	for i, t := range trades {
		market := fmt.Sprintf("0x%064x", 100+i)
		meme := fmt.Sprintf("0x%040x", 100+i)
		fee, tax := "100", "200"
		a := TradeActivity{Source: t.Source, MarketID: market, Timestamp: fmt.Sprint(t.Timestamp), Venue: "curve", AmountBasis: "CURVE_EXCLUDING_FEE_TAX", MemeAsset: meme, QuoteAsset: r.QuoteAsset, QuoteDecimals: 6, MemeRaw: t.MemeRaw, QuoteRaw: t.QuoteRaw, Classification: t.Classification, FeeRaw: &fee, FeeAsset: &r.QuoteAsset, TaxRaw: &tax, FeeStatus: "event_reported"}
		if i == 1 {
			a.Venue = "pool"
			a.AmountBasis = "POOL_CORE"
			a.FeeRaw = nil
			a.FeeAsset = nil
			a.TaxRaw = nil
			a.FeeStatus = "not_provided"
		}
		m := MarketTrades{MarketID: market, MemeAsset: meme, QuoteAsset: r.QuoteAsset, QuoteDecimals: 6, Coverage: coverage, Items: []TradeActivity{a}}
		inputs = append(inputs, AssetMarketTrades{AssetUID: r.MarketID, Trades: m})
	}
	return coverage, inputs
}
func TestAssetStatsGroupFlowsAndUnknownFees(t *testing.T) {
	c, inputs := assetStatsFixture()
	got, e := AggregateAssetTrades(4663, c, inputs)
	if e != nil || len(got) != 1 {
		t.Fatal(got, e)
	}
	g := got[0]
	if g.MarketCount != 3 || g.TradingMarketCount != 3 || g.TradeCount != 3 || g.InternalTradeCount != 1 || g.UnclassifiedTradeCount != 2 || g.QuoteVolumeRaw != "7000000" || g.InternalQuoteVolumeRaw != "4000000" || g.UnknownFeeTradeCount != 1 || len(g.Fees) != 1 || g.Fees[0].FeeRaw != "200" || g.Fees[0].TaxRaw != "400" {
		t.Fatal(g)
	}
	// Different quote assets are separate even when associated with one STOCK.
	third := &inputs[2].Trades
	third.QuoteAsset = fmt.Sprintf("0x%040x", 300)
	third.Items[0].QuoteAsset = third.QuoteAsset
	third.Items[0].FeeAsset = &third.QuoteAsset
	got, e = AggregateAssetTrades(4663, c, inputs)
	if e != nil || len(got) != 2 {
		t.Fatal(got, e)
	}
}
func TestAssetStatsRejectMixedCoverageDuplicatesAndUnits(t *testing.T) {
	for _, mode := range []string{"coverage", "market", "event", "decimals", "amount", "asset", "classification", "fee"} {
		t.Run(mode, func(t *testing.T) {
			c, in := assetStatsFixture()
			switch mode {
			case "coverage":
				in[1].Trades.Coverage.ProjectionNumber++
			case "market":
				in[1] = in[0]
			case "event":
				in[1].Trades.Items[0].Source = in[0].Trades.Items[0].Source
			case "decimals":
				in[1].Trades.QuoteDecimals = 18
			case "amount":
				in[0].Trades.Items[0].QuoteRaw = "1e6"
			case "asset":
				in[0].AssetUID = "bad"
			case "classification":
				in[0].Trades.Items[0].Classification = "user"
			case "fee":
				value := "1"
				in[1].Trades.Items[0].FeeRaw = &value
			}
			if _, e := AggregateAssetTrades(4663, c, in); e == nil {
				t.Fatal(mode)
			}
		})
	}
}

func TestAssetStatsKeepInactiveMarketsAndMemeFeeUnits(t *testing.T) {
	c, in := assetStatsFixture()
	amount := "9"
	asset := in[1].Trades.MemeAsset
	in[1].Trades.Items[0].FeeStatus = "paired_event"
	in[1].Trades.Items[0].FeeRaw = &amount
	in[1].Trades.Items[0].FeeAsset = &asset
	in[2].Trades.Items = nil
	got, e := AggregateAssetTrades(4663, c, in)
	if e != nil || len(got) != 1 {
		t.Fatal(got, e)
	}
	if got[0].MarketCount != 3 || got[0].TradingMarketCount != 2 || len(got[0].Fees) != 2 || got[0].UnknownFeeTradeCount != 0 {
		t.Fatal(got)
	}
	found := false
	for _, f := range got[0].Fees {
		if f.Asset == asset {
			found = true
			if f.Decimals != 18 || f.FeeRaw != "9" || f.TaxRaw != "0" {
				t.Fatal(f)
			}
		}
	}
	if !found {
		t.Fatal("missing separate Meme fee asset")
	}
}
