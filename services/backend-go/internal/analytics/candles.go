package analytics

import (
	"errors"
	"math/big"
	"sort"
	"strconv"
	"strings"
)

var ErrCandles = errors.New("invalid or incomplete candle input")

// CandleTrade is a canonical normalized execution, not a summary/allocation.
// QuoteRaw excludes Curve fee/tax and uses the Pool core delta. Internal
// conversions are included in pool price discovery but broken out in volume.
type CandleTrade struct {
	Source                            CurveSource
	Timestamp                         uint64
	MarketID, MemeAsset, QuoteAsset   string
	QuoteDecimals                     uint8
	MemeRaw, QuoteRaw, Classification string
}

type CandleRange struct {
	ChainID                         uint64
	MarketID, MemeAsset, QuoteAsset string
	QuoteDecimals                   uint8
	From, To, Interval              uint64
}

type CandlePrice struct {
	Numerator   string `json:"numerator"`
	Denominator string `json:"denominator"`
}

type Candle struct {
	Timestamp              uint64       `json:"timestamp"`
	Open                   *CandlePrice `json:"open"`
	High                   *CandlePrice `json:"high"`
	Low                    *CandlePrice `json:"low"`
	Close                  *CandlePrice `json:"close"`
	MemeVolumeRaw          string       `json:"memeVolumeRaw"`
	QuoteVolumeRaw         string       `json:"quoteVolumeRaw"`
	InternalMemeVolumeRaw  string       `json:"internalMemeVolumeRaw"`
	InternalQuoteVolumeRaw string       `json:"internalQuoteVolumeRaw"`
	TradeCount             uint64       `json:"tradeCount"`
	InternalTradeCount     uint64       `json:"internalTradeCount"`
	UnclassifiedTradeCount uint64       `json:"unclassifiedTradeCount"`
}

type CandleSeries struct {
	Candles         []Candle `json:"candles"`
	PriceUnit       string   `json:"priceUnit"`
	VolumeBasis     string   `json:"volumeBasis"`
	PricePopulation string   `json:"pricePopulation"`
	EmptyPolicy     string   `json:"emptyPolicy"`
}

// BuildCandles expects complete input for [From,To). It cannot prove coverage;
// the persistent reader must prove it before exposing zero-volume intervals.
// Empty buckets have null OHLC; no carry-forward or synthetic trade is created.
func BuildCandles(r CandleRange, trades []CandleTrade) (CandleSeries, error) {
	fail := func() (CandleSeries, error) { return CandleSeries{}, ErrCandles }
	intervals := map[uint64]bool{60: true, 300: true, 900: true, 3600: true, 14400: true, 86400: true}
	zeroAddress := "0x" + strings.Repeat("0", 40)
	if r.ChainID == 0 || r.MemeAsset == zeroAddress || (r.QuoteAsset == zeroAddress && r.QuoteDecimals != 18) || !intervals[r.Interval] || r.To <= r.From || r.From%r.Interval != 0 || r.To%r.Interval != 0 || (r.To-r.From)/r.Interval > 2000 || len(trades) > 100000 || !hashRE.MatchString(r.MarketID) || !addressRE.MatchString(r.MemeAsset) || !addressRE.MatchString(r.QuoteAsset) || r.MemeAsset == r.QuoteAsset || r.QuoteDecimals < 6 || r.QuoteDecimals > 18 {
		return fail()
	}
	sorted := append([]CandleTrade{}, trades...)
	heights := map[string]*big.Int{}
	seen := map[string]bool{}
	for _, t := range sorted {
		if !validSource(t.Source, r.ChainID, t.Source.EventKey) || seen[t.Source.EventKey] || t.Timestamp < r.From || t.Timestamp >= r.To || t.MarketID != r.MarketID || t.MemeAsset != r.MemeAsset || t.QuoteAsset != r.QuoteAsset || t.QuoteDecimals != r.QuoteDecimals {
			return fail()
		}
		h, e := uint256(t.Source.BlockNumber)
		if e != nil {
			return fail()
		}
		heights[t.Source.EventKey] = h
		seen[t.Source.EventKey] = true
	}
	sort.Slice(sorted, func(i, j int) bool {
		a, b := sorted[i].Source, sorted[j].Source
		c := heights[a.EventKey].Cmp(heights[b.EventKey])
		if c != 0 {
			return c < 0
		}
		if a.TransactionIndex != b.TransactionIndex {
			return a.TransactionIndex < b.TransactionIndex
		}
		return a.LogIndex < b.LogIndex
	})
	out := CandleSeries{Candles: make([]Candle, (r.To-r.From)/r.Interval), PriceUnit: "QUOTE_PER_WHOLE_MEME", VolumeBasis: "CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE", PricePopulation: "ALL_EXECUTIONS_INCLUDING_INTERNAL_CONVERSIONS", EmptyPolicy: "NULL_OHLC_ZERO_VOLUME"}
	for i := range out.Candles {
		out.Candles[i] = Candle{Timestamp: r.From + uint64(i)*r.Interval, MemeVolumeRaw: "0", QuoteVolumeRaw: "0", InternalMemeVolumeRaw: "0", InternalQuoteVolumeRaw: "0"}
	}
	add := func(s string, n *big.Int) string { x, _ := new(big.Int).SetString(s, 10); return x.Add(x, n).String() }
	price := func(x *big.Rat) *CandlePrice {
		return &CandlePrice{Numerator: x.Num().String(), Denominator: x.Denom().String()}
	}
	rat := func(x *CandlePrice) *big.Rat {
		n, _ := new(big.Int).SetString(x.Numerator, 10)
		d, _ := new(big.Int).SetString(x.Denominator, 10)
		return new(big.Rat).SetFrac(n, d)
	}
	for i, t := range sorted {
		if i > 0 {
			p := sorted[i-1]
			same := heights[p.Source.EventKey].Cmp(heights[t.Source.EventKey]) == 0
			if t.Timestamp < p.Timestamp || (same && (p.Source.BlockHash != t.Source.BlockHash || p.Timestamp != t.Timestamp || p.Source.LogIndex >= t.Source.LogIndex || (p.Source.TransactionIndex == t.Source.TransactionIndex && p.Source.TransactionHash != t.Source.TransactionHash))) {
				return fail()
			}
		}
		meme, e := uint256(t.MemeRaw)
		if e != nil || meme.Sign() == 0 {
			return fail()
		}
		quote, e := uint256(t.QuoteRaw)
		if e != nil || quote.Sign() == 0 {
			return fail()
		}
		internal := t.Classification == "internal_reward_conversion" || t.Classification == "internal_holder_conversion"
		if !internal && t.Classification != "unclassified" {
			return fail()
		}
		x := new(big.Rat).SetFrac(new(big.Int).Mul(quote, new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)), new(big.Int).Mul(meme, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(r.QuoteDecimals)), nil)))
		c := &out.Candles[(t.Timestamp-r.From)/r.Interval]
		if c.Open == nil {
			c.Open = price(x)
			c.High = price(x)
			c.Low = price(x)
		}
		if x.Cmp(rat(c.High)) > 0 {
			c.High = price(x)
		}
		if x.Cmp(rat(c.Low)) < 0 {
			c.Low = price(x)
		}
		c.Close = price(x)
		c.TradeCount++
		c.MemeVolumeRaw = add(c.MemeVolumeRaw, meme)
		c.QuoteVolumeRaw = add(c.QuoteVolumeRaw, quote)
		if internal {
			c.InternalTradeCount++
			c.InternalMemeVolumeRaw = add(c.InternalMemeVolumeRaw, meme)
			c.InternalQuoteVolumeRaw = add(c.InternalQuoteVolumeRaw, quote)
		} else {
			c.UnclassifiedTradeCount++
		}
	}
	return out, nil
}

func CurveCandleTrade(o CurveObservation) (CandleTrade, error) {
	ts, err := strconv.ParseUint(o.BlockTimestamp, 10, 64)
	if err != nil || strconv.FormatUint(ts, 10) != o.BlockTimestamp {
		return CandleTrade{}, ErrCandles
	}
	return CandleTrade{Source: o.Source, Timestamp: ts, MarketID: o.MarketID, MemeAsset: o.MemeToken, QuoteAsset: o.QuoteAsset, QuoteDecimals: o.QuoteDecimals, MemeRaw: o.Amounts.MemeRaw, QuoteRaw: o.Amounts.QuoteCurveRaw, Classification: o.Classification}, nil
}
func PoolCandleTrade(o PoolObservation) (CandleTrade, error) {
	ts, err := strconv.ParseUint(o.BlockTimestamp, 10, 64)
	if err != nil || strconv.FormatUint(ts, 10) != o.BlockTimestamp {
		return CandleTrade{}, ErrCandles
	}
	return CandleTrade{Source: o.Source, Timestamp: ts, MarketID: o.MarketID, MemeAsset: o.MemeToken, QuoteAsset: o.QuoteAsset, QuoteDecimals: o.QuoteDecimals, MemeRaw: o.Amounts.MemeCoreRaw, QuoteRaw: o.Amounts.QuoteCoreRaw, Classification: o.Classification}, nil
}
