package analytics

import (
	"fmt"
	"math/big"
	"strings"
	"testing"
)

func candleFixture() (CandleRange, []CandleTrade) {
	r := CandleRange{ChainID: 4663, MarketID: "0x" + strings.Repeat("1", 64), MemeAsset: "0x" + strings.Repeat("2", 40), QuoteAsset: "0x" + strings.Repeat("3", 40), QuoteDecimals: 6, From: 60, To: 240, Interval: 60}
	trades := []CandleTrade{}
	for i, q := range []string{"2000000", "4000000", "1000000"} {
		source := CurveSource{ChainID: 4663, BlockNumber: fmt.Sprint(i + 1), BlockHash: fmt.Sprintf("0x%064x", i+1), TransactionHash: fmt.Sprintf("0x%064x", i+10), Emitter: r.MemeAsset, LogIndex: 0}
		source.EventKey = fmt.Sprintf("4663:%s:0", source.TransactionHash)
		trades = append(trades, CandleTrade{Source: source, Timestamp: uint64(61 + i), MarketID: r.MarketID, MemeAsset: r.MemeAsset, QuoteAsset: r.QuoteAsset, QuoteDecimals: 6, MemeRaw: "1000000000000000000", QuoteRaw: q, Classification: "unclassified"})
	}
	trades[1].Classification = "internal_reward_conversion"
	return r, trades
}
func TestCandlesExactOHLCAndEmptyBuckets(t *testing.T) {
	r, ts := candleFixture()
	ts[0], ts[2] = ts[2], ts[0]
	got, e := BuildCandles(r, ts)
	if e != nil {
		t.Fatal(e)
	}
	c := got.Candles[0]
	if c.Open.Numerator != "2" || c.High.Numerator != "4" || c.Low.Numerator != "1" || c.Close.Numerator != "1" || c.Open.Denominator != "1" || c.TradeCount != 3 || c.InternalTradeCount != 1 || c.UnclassifiedTradeCount != 2 || c.QuoteVolumeRaw != "7000000" || c.InternalQuoteVolumeRaw != "4000000" || c.MemeVolumeRaw != "3000000000000000000" {
		t.Fatal(c)
	}
	for _, c := range got.Candles[1:] {
		if c.Open != nil || c.High != nil || c.Low != nil || c.Close != nil || c.TradeCount != 0 || c.QuoteVolumeRaw != "0" {
			t.Fatal(c)
		}
	}
	if ts[0].Timestamp != 63 {
		t.Fatal("caller input reordered")
	}
}
func TestCandlesBoundariesAndLargeSums(t *testing.T) {
	r, ts := candleFixture()
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	ts = ts[:2]
	for i := range ts {
		ts[i].QuoteRaw = max.String()
		ts[i].MemeRaw = "3"
		ts[i].Timestamp = 120
	}
	got, e := BuildCandles(r, ts)
	if e != nil {
		t.Fatal(e)
	}
	c := got.Candles[1]
	want := new(big.Int).Mul(max, big.NewInt(2)).String()
	if got.Candles[0].Open != nil || c.QuoteVolumeRaw != want || c.TradeCount != 2 {
		t.Fatal(got)
	}
	ts[1].Timestamp = r.To
	if _, e = BuildCandles(r, ts); e == nil {
		t.Fatal("exclusive end accepted")
	}
}
func TestCandlesRejectIncompleteIdentityAndOrder(t *testing.T) {
	for _, mode := range []string{"duplicate", "branch", "timestamp", "market", "asset", "decimals", "classification", "zero", "overflow", "range", "interval", "bound"} {
		t.Run(mode, func(t *testing.T) {
			r, ts := candleFixture()
			switch mode {
			case "duplicate":
				ts[1] = ts[0]
			case "branch":
				ts[1].Source.BlockNumber = ts[0].Source.BlockNumber
			case "timestamp":
				ts[1].Timestamp = 60
			case "market":
				ts[1].MarketID = ts[1].Source.BlockHash
			case "asset":
				ts[1].QuoteAsset = ts[1].MemeAsset
			case "decimals":
				ts[1].QuoteDecimals = 18
			case "classification":
				ts[1].Classification = "user"
			case "zero":
				ts[1].MemeRaw = "0"
			case "overflow":
				ts[1].QuoteRaw = new(big.Int).Lsh(big.NewInt(1), 256).String()
			case "range":
				r.From = 61
			case "interval":
				r.Interval = 1
			case "bound":
				r.To = 60 * 2002
			}
			if _, e := BuildCandles(r, ts); e == nil {
				t.Fatal(mode)
			}
		})
	}
}
func TestCandleObservationAdapters(t *testing.T) {
	c, e := CurveCandleTrade(CurveObservation{BlockTimestamp: "60", Amounts: CurveAmounts{MemeRaw: "5", QuoteCurveRaw: "7", QuoteCashFlowRaw: "9"}})
	if e != nil || c.QuoteRaw != "7" {
		t.Fatal(c, e)
	}
	p, e := PoolCandleTrade(PoolObservation{BlockTimestamp: "60", Amounts: PoolAmounts{MemeCoreRaw: "5", QuoteCoreRaw: "7"}})
	if e != nil || p.QuoteRaw != "7" {
		t.Fatal(p, e)
	}
	if _, e = CurveCandleTrade(CurveObservation{BlockTimestamp: "060"}); e == nil {
		t.Fatal("noncanonical timestamp")
	}
}
