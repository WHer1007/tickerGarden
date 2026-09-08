// Package tokendetail serves display-only analytics. It never quotes a trade or
// supplies settlement inputs. All amounts remain decimal strings across the API.
package tokendetail

import (
	"errors"
	"math/big"
	"regexp"
	"time"
)

const Version = 1
const SupplyBasis = "TOTAL_MINUS_KNOWN_PROTOCOL_BALANCES_V1"
const VolumeBasis = "EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE"

var ErrUnavailable = errors.New("token detail analytics unavailable")
var hash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var address = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var integer = regexp.MustCompile(`^(0|[1-9][0-9]{0,77})$`)
var decimal = regexp.MustCompile(`^(0|[1-9][0-9]{0,100})(\.[0-9]{1,36})?$`)

type Source struct {
	Provider    string `json:"provider"`
	AsOf        uint64 `json:"asOf"`
	BlockNumber string `json:"blockNumber"`
	BlockHash   string `json:"blockHash"`
	QueryID     string `json:"queryId,omitempty"`
	ExecutionID string `json:"executionId,omitempty"`
	CachedAt    uint64 `json:"cachedAt,omitempty"`
}
type Statistics struct {
	Price       *string `json:"price"`
	Volume24h   *string `json:"volume24h"`
	VolumeFrom  uint64  `json:"volumeFrom"`
	VolumeTo    uint64  `json:"volumeTo"`
	VolumeBasis string  `json:"volumeBasis"`
}
type Point struct {
	Timestamp uint64  `json:"timestamp"`
	Price     *string `json:"price"`
}
type Chart struct {
	From     uint64  `json:"from"`
	To       uint64  `json:"to"`
	Interval uint64  `json:"interval"`
	Points   []Point `json:"points"`
}
type Trade struct {
	Timestamp      uint64  `json:"timestamp"`
	Side           string  `json:"side"`
	Price          string  `json:"price"`
	MemeRaw        string  `json:"memeRaw"`
	QuoteRaw       string  `json:"quoteRaw"`
	Actor          *string `json:"actor"`
	TxHash         string  `json:"txHash"`
	EventKey       string  `json:"eventKey"`
	Classification string  `json:"classification"`
}
type Holder struct {
	Account    string `json:"account"`
	BalanceRaw string `json:"balanceRaw"`
}
type Holders struct {
	TotalSupplyRaw       string   `json:"totalSupplyRaw"`
	CirculatingSupplyRaw string   `json:"circulatingSupplyRaw"`
	Count                uint64   `json:"count"`
	Basis                string   `json:"basis"`
	Items                []Holder `json:"items"`
}
type Fee struct {
	Recipient string `json:"recipient"`
	Asset     string `json:"asset"`
	AmountRaw string `json:"amountRaw"`
}
type Report struct {
	Version       int               `json:"version"`
	ChainID       uint64            `json:"chainId"`
	DisplayOnly   bool              `json:"displayOnly"`
	MarketID      string            `json:"marketId"`
	MemeToken     string            `json:"memeToken"`
	QuoteAsset    string            `json:"quoteAsset"`
	QuoteDecimals uint8             `json:"quoteDecimals"`
	Period        string            `json:"period"`
	Statistics    *Statistics       `json:"statistics"`
	Chart         *Chart            `json:"chart"`
	Trades        []Trade           `json:"trades"`
	Holders       *Holders          `json:"holders"`
	Fees          []Fee             `json:"fees"`
	Sources       map[string]Source `json:"sources"`
	Reasons       map[string]string `json:"reasons"`
}

func Period(p string) (duration, interval uint64, ok bool) {
	v, ok := map[string][2]uint64{"1H": {3600, 60}, "12H": {43200, 300}, "1D": {86400, 900}}[p]
	return v[0], v[1], ok
}
func str(s string) *string { return &s }
func number(s string) *big.Int {
	n, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return new(big.Int)
	}
	return n
}
func whole(raw string, decimals uint8) string {
	return new(big.Rat).SetFrac(number(raw), new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)).FloatString(int(decimals))
}
func fresh(s Source, now time.Time) bool {
	return s.AsOf > 0 && s.AsOf <= uint64(now.Unix()+30) && now.Unix()-int64(s.AsOf) <= 1200 && integer.MatchString(s.BlockNumber) && hash.MatchString(s.BlockHash)
}

// Validate rejects ambiguous identity, stale/partial windows and numeric loss.
func Validate(r Report, chain uint64, now time.Time) error {
	bad := func() error { return ErrUnavailable }
	if r.Version != Version || r.ChainID != chain || !r.DisplayOnly || !hash.MatchString(r.MarketID) || !address.MatchString(r.MemeToken) || !address.MatchString(r.QuoteAsset) || r.MemeToken == r.QuoteAsset || r.QuoteDecimals < 6 || r.QuoteDecimals > 18 {
		return bad()
	}
	duration, interval, ok := Period(r.Period)
	if !ok {
		return bad()
	}
	has := map[string]bool{"statistics": r.Statistics != nil, "chart": r.Chart != nil, "trades": r.Trades != nil, "holders": r.Holders != nil, "fees": r.Fees != nil}
	for k, present := range has {
		if present {
			s, ok := r.Sources[k]
			if !ok || !fresh(s, now) {
				return bad()
			}
		}
	}
	if s := r.Statistics; s != nil {
		if s.VolumeBasis != VolumeBasis || s.VolumeTo < 86400 || s.VolumeFrom != s.VolumeTo-86400 || s.VolumeTo > r.Sources["statistics"].AsOf || r.Sources["statistics"].AsOf-s.VolumeTo > interval {
			return bad()
		}
		for _, v := range []*string{s.Price, s.Volume24h} {
			if v != nil && !decimal.MatchString(*v) {
				return bad()
			}
		}
		if s.Price != nil && numberRat(*s.Price).Sign() <= 0 {
			return bad()
		}
	}
	if c := r.Chart; c != nil {
		if c.Interval != interval || c.From >= c.To || c.To > r.Sources["chart"].AsOf || r.Sources["chart"].AsOf-c.To > interval || c.From%interval != 0 || c.To%interval != 0 || len(c.Points) > 2000 || uint64(len(c.Points)) != (c.To-c.From)/interval || (duration != 0 && c.To-c.From != duration) {
			return bad()
		}
		for i, p := range c.Points {
			if p.Timestamp != c.From+uint64(i)*interval || (p.Price != nil && (!decimal.MatchString(*p.Price) || numberRat(*p.Price).Sign() <= 0)) {
				return bad()
			}
		}
	}
	if len(r.Trades) > 100 {
		return bad()
	}
	seen := map[string]bool{}
	var previous uint64 = ^uint64(0)
	for _, t := range r.Trades {
		if t.Timestamp > previous || t.Timestamp > r.Sources["trades"].AsOf || !decimal.MatchString(t.Price) || numberRat(t.Price).Sign() <= 0 || !integer.MatchString(t.MemeRaw) || t.MemeRaw == "0" || !integer.MatchString(t.QuoteRaw) || t.QuoteRaw == "0" || !hash.MatchString(t.TxHash) || len(t.EventKey) == 0 || len(t.EventKey) > 200 || seen[t.EventKey] || (t.Side != "buy" && t.Side != "sell") || (t.Actor != nil && !address.MatchString(*t.Actor)) || (t.Classification != "unclassified" && t.Classification != "internal_reward_conversion" && t.Classification != "internal_holder_conversion") {
			return bad()
		}
		previous = t.Timestamp
		seen[t.EventKey] = true
	}
	if h := r.Holders; h != nil {
		if h.Basis != SupplyBasis || !integer.MatchString(h.TotalSupplyRaw) || !integer.MatchString(h.CirculatingSupplyRaw) || number(h.CirculatingSupplyRaw).Cmp(number(h.TotalSupplyRaw)) > 0 || len(h.Items) > 100 || h.Count < uint64(len(h.Items)) {
			return bad()
		}
		seen := map[string]bool{}
		sum := new(big.Int)
		var prev *big.Int
		for _, v := range h.Items {
			n := number(v.BalanceRaw)
			if !address.MatchString(v.Account) || v.Account == "0x0000000000000000000000000000000000000000" || seen[v.Account] || !integer.MatchString(v.BalanceRaw) || n.Sign() <= 0 || (prev != nil && n.Cmp(prev) > 0) {
				return bad()
			}
			sum.Add(sum, n)
			prev = n
			seen[v.Account] = true
		}
		if sum.Cmp(number(h.CirculatingSupplyRaw)) > 0 {
			return bad()
		}
	}
	if len(r.Fees) > 8 {
		return bad()
	}
	seen = map[string]bool{}
	for _, f := range r.Fees {
		key := f.Recipient + f.Asset
		if seen[key] || (f.Recipient != "creator" && f.Recipient != "stakers" && f.Recipient != "platform" && f.Recipient != "holders") || (f.Asset != r.MemeToken && f.Asset != r.QuoteAsset) || !integer.MatchString(f.AmountRaw) {
			return bad()
		}
		seen[key] = true
	}
	return nil
}
func numberRat(s string) *big.Rat {
	v, ok := new(big.Rat).SetString(s)
	if !ok {
		return new(big.Rat)
	}
	return v
}
