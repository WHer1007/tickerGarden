package tokendetail

import (
	"context"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"sync"
	"tickergarden/backend/internal/analytics"
	"tickergarden/backend/internal/readmodel"
	"time"
)

type History interface {
	Candles(context.Context, string, uint64, uint64, uint64) (analytics.MarketCandles, error)
	Trades(context.Context, string, uint64, uint64, int, string) (analytics.TradePage, error)
	Holders(context.Context, string) (analytics.MarketHolders, error)
	DetailTip(context.Context) (uint64, string, string, error)
	DetailFees(context.Context, string, uint64, uint64) (analytics.DetailFeesResult, error)
	DetailBlock(context.Context, string, string) (uint64, error)
}
type Service struct {
	ChainID uint64
	Models  readmodel.Reader
	History History
	Dune    *Dune
	mu      sync.Mutex
	cache   map[string]cached
}
type cached struct {
	report   Report
	until    time.Time
	revision string
}

func (s *Service) Detail(ctx context.Context, marketID, period string) (Report, error) {
	if !hash.MatchString(marketID) {
		return Report{}, ErrUnavailable
	}
	if _, _, ok := Period(period); !ok {
		return Report{}, ErrUnavailable
	}
	if s.Models == nil {
		return Report{}, ErrUnavailable
	}
	snap, e := s.Models.Load(ctx, "")
	if e != nil || snap.Sync.ChainID != s.ChainID || snap.Sync.Status != "synced" || snap.Sync.Finality != "finalized" {
		return Report{}, ErrUnavailable
	}
	var market *readmodel.MarketReadModel
	for i := range snap.Markets {
		if snap.Markets[i].MarketID == marketID {
			market = &snap.Markets[i]
			break
		}
	}
	if market == nil {
		return Report{}, ErrUnavailable
	}
	var decimals uint8
	for _, c := range snap.Configs {
		if c.Kind == "quote" && c.ID == market.QuoteAssetConfigID {
			d, e := strconv.ParseUint(fmt.Sprint(c.Values["quoteDecimals"]), 10, 8)
			if e == nil {
				decimals = uint8(d)
			}
		}
	}
	if decimals < 6 || decimals > 18 {
		return Report{}, ErrUnavailable
	}
	// Reuse short-lived reports; never hold a cache lock during I/O.
	s.mu.Lock()
	now := time.Now()
	key := marketID + ":" + period
	if c, ok := s.cache[key]; ok && now.Before(c.until) && c.revision == snap.Sync.Revision {
		s.mu.Unlock()
		return c.report, nil
	}
	s.mu.Unlock()
	r := Report{Version: Version, ChainID: s.ChainID, DisplayOnly: true, MarketID: marketID, MemeToken: market.MemeToken, QuoteAsset: market.QuoteAsset, QuoteDecimals: decimals, Period: period, Sources: map[string]Source{}, Reasons: map[string]string{}}
	if s.Dune != nil {
		_ = s.Dune.EnsureRefresh(ctx, s.ChainID)
	}
	if d, ok := s.Dune.Get(s.ChainID, marketID, period, now); ok && d.MemeToken == r.MemeToken && d.QuoteAsset == r.QuoteAsset && d.QuoteDecimals == decimals {
		r.Statistics = d.Statistics
		r.Chart = d.Chart
		r.Trades = d.Trades
		r.Holders = d.Holders
		r.Fees = d.Fees
		for k, v := range d.Sources {
			r.Sources[k] = v
		}
	}
	if s.History != nil && (r.Statistics == nil || r.Chart == nil || r.Trades == nil || r.Holders == nil || r.Fees == nil) {
		s.fallback(ctx, &r, market)
	}
	for k, missing := range map[string]bool{"statistics": r.Statistics == nil, "chart": r.Chart == nil, "trades": r.Trades == nil, "holders": r.Holders == nil, "fees": r.Fees == nil} {
		if missing {
			r.Reasons[k] = "Finalized index coverage unavailable"
			if s.Dune != nil {
				r.Reasons[k] = "Dune result missing or stale; finalized index coverage unavailable"
			}
		}
	}
	s.mu.Lock()
	if s.cache == nil || len(s.cache) >= 64 {
		s.cache = map[string]cached{}
	}
	s.cache[key] = cached{r, now.Add(30 * time.Second), snap.Sync.Revision}
	s.mu.Unlock()
	return r, nil
}
func (s *Service) fallback(ctx context.Context, r *Report, m *readmodel.MarketReadModel) {
	tip, block, blockHash, e := s.History.DetailTip(ctx)
	source := Source{Provider: "indexer", AsOf: tip, BlockNumber: block, BlockHash: blockHash}
	if e != nil || !fresh(source, time.Now()) {
		return
	}
	duration, interval, _ := Period(r.Period)
	to := tip / interval * interval
	var created uint64
	if m.Identity != nil {
		created, _ = strconv.ParseUint(m.Identity.DeployedAt, 10, 64)
	}
	from := uint64(0)
	if duration == 0 {
		from = created / interval * interval
	} else if to > duration {
		from = to - duration
	}
	if r.Chart == nil && from > 0 && from < to && (to-from)/interval <= 2000 {
		if c, e := s.History.Candles(ctx, r.MarketID, from, to, interval); e == nil && c.MemeAsset == r.MemeToken && c.QuoteAsset == r.QuoteAsset && c.QuoteDecimals == r.QuoteDecimals {
			chart := &Chart{From: from, To: to, Interval: interval, Points: []Point{}}
			for _, c := range c.Series.Candles {
				chart.Points = append(chart.Points, Point{c.Timestamp, price(c.Close)})
			}
			r.Chart = chart
			r.Sources["chart"] = s.checkpoint(ctx, strconv.FormatUint(c.Coverage.ProjectionNumber, 10), c.Coverage.ProjectionHash)
		}
	}
	if r.Statistics == nil && tip > 86400 {
		if c, e := s.History.Candles(ctx, r.MarketID, (tip/60*60)-86400, tip/60*60, 60); e == nil && c.MemeAsset == r.MemeToken && c.QuoteAsset == r.QuoteAsset {
			volume := new(big.Int)
			var last *string
			for _, v := range c.Series.Candles {
				volume.Add(volume, new(big.Int).Sub(number(v.QuoteVolumeRaw), number(v.InternalQuoteVolumeRaw)))
				if v.Close != nil {
					last = price(v.Close)
				}
			}
			r.Statistics = &Statistics{last, str(whole(volume.String(), r.QuoteDecimals)), c.Coverage.From, c.Coverage.To, VolumeBasis}
			r.Sources["statistics"] = s.checkpoint(ctx, strconv.FormatUint(c.Coverage.ProjectionNumber, 10), c.Coverage.ProjectionHash)
		}
	}
	if r.Trades == nil && tip > 86400 {
		if t, e := s.History.Trades(ctx, r.MarketID, tip-86400, tip, 100, ""); e == nil && t.MemeAsset == r.MemeToken && t.QuoteAsset == r.QuoteAsset {
			r.Trades = []Trade{}
			for _, v := range t.Items {
				ts, _ := strconv.ParseUint(v.Timestamp, 10, 64)
				p := price(&v.Price)
				if p == nil {
					continue
				}
				r.Trades = append(r.Trades, Trade{ts, v.Side, *p, v.MemeRaw, v.QuoteRaw, v.Actor, v.Source.TransactionHash, v.Source.EventKey, v.Classification})
			}
			r.Sources["trades"] = s.checkpoint(ctx, strconv.FormatUint(t.Coverage.ProjectionNumber, 10), t.Coverage.ProjectionHash)
		}
	}
	if r.Holders == nil {
		if h, e := s.History.Holders(ctx, r.MarketID); e == nil && h.MemeToken == r.MemeToken && h.Finality == "finalized" {
			out := &Holders{TotalSupplyRaw: h.TotalSupplyRaw, Basis: SupplyBasis, Items: []Holder{}}
			circulating := new(big.Int)
			for _, v := range h.Balances {
				if !v.Excluded {
					circulating.Add(circulating, number(v.BalanceRaw))
					out.Items = append(out.Items, Holder{v.Account, v.BalanceRaw})
				}
			}
			out.CirculatingSupplyRaw = circulating.String()
			out.Count = uint64(len(out.Items))
			sort.Slice(out.Items, func(i, j int) bool {
				a, b := out.Items[i], out.Items[j]
				c := number(a.BalanceRaw).Cmp(number(b.BalanceRaw))
				if c == 0 {
					return a.Account < b.Account
				}
				return c > 0
			})
			if len(out.Items) > 100 {
				out.Items = out.Items[:100]
			}
			r.Holders = out
			r.Sources["holders"] = s.checkpoint(ctx, h.SourceBlockNumber, h.SourceBlockHash)
		}
	}
	if r.Fees == nil && created > 0 && created < tip {
		if fees, e := s.History.DetailFees(ctx, r.MarketID, created, tip); e == nil {
			r.Fees = []Fee{}
			for _, f := range fees.Fees {
				r.Fees = append(r.Fees, Fee{f.Recipient, f.Asset, f.AmountRaw})
			}
			r.Sources["fees"] = s.checkpoint(ctx, strconv.FormatUint(fees.Coverage.ProjectionNumber, 10), fees.Coverage.ProjectionHash)
		}
	}
	// A projection may advance between independent readers. Never bless an
	// internally invalid result; leave only the affected section unavailable.
	for _, k := range []string{"statistics", "chart", "trades", "holders", "fees"} {
		one := Report{Version: r.Version, ChainID: r.ChainID, DisplayOnly: true, MarketID: r.MarketID, MemeToken: r.MemeToken, QuoteAsset: r.QuoteAsset, QuoteDecimals: r.QuoteDecimals, Period: r.Period, Sources: r.Sources}
		switch k {
		case "statistics":
			one.Statistics = r.Statistics
		case "chart":
			one.Chart = r.Chart
		case "trades":
			one.Trades = r.Trades
		case "holders":
			one.Holders = r.Holders
		case "fees":
			one.Fees = r.Fees
		}
		if Validate(one, r.ChainID, time.Now()) != nil {
			switch k {
			case "statistics":
				r.Statistics = nil
			case "chart":
				r.Chart = nil
			case "trades":
				r.Trades = nil
			case "holders":
				r.Holders = nil
			case "fees":
				r.Fees = nil
			}
			delete(r.Sources, k)
		}
	}
}
func price(p *analytics.CandlePrice) *string {
	if p == nil {
		return nil
	}
	n, d := number(p.Numerator), number(p.Denominator)
	if n.Sign() <= 0 || d.Sign() <= 0 {
		return nil
	}
	v := new(big.Rat).SetFrac(n, d).FloatString(36)
	if numberRat(v).Sign() == 0 {
		return nil
	}
	return &v
}

func (s *Service) checkpoint(ctx context.Context, number, hash string) Source {
	ts, err := s.History.DetailBlock(ctx, number, hash)
	if err != nil {
		return Source{}
	}
	return Source{Provider: "indexer", AsOf: ts, BlockNumber: number, BlockHash: hash}
}
