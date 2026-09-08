package analytics

import (
	"context"
	"math/big"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

type rowReader interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type MarketCandles struct {
	MarketID      string        `json:"marketId"`
	MemeAsset     string        `json:"memeAsset"`
	QuoteAsset    string        `json:"quoteAsset"`
	QuoteDecimals uint8         `json:"quoteDecimals"`
	Interval      uint64        `json:"interval"`
	Coverage      RangeCoverage `json:"coverage"`
	Series        CandleSeries  `json:"series"`
}

// LoadMarketTrades reads a complete bounded execution interval. No truncation
// or conversion-summary double counting is allowed. PageTrades paginates the result.
func LoadMarketTrades(ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, market string, from, to uint64) (MarketTrades, error) {
	fail := func() (MarketTrades, error) { return MarketTrades{}, ErrCandles }
	if pool == nil || !hashRE.MatchString(market) {
		return fail()
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	out, err := loadMarketTrades(ctx, tx, m, market, from, to, nil)
	if err != nil {
		return MarketTrades{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MarketTrades{}, err
	}
	return out, nil
}

// verifiedCoverage must have been verified using this same transaction.
func loadMarketTrades(ctx context.Context, tx pgx.Tx, m deployment.Manifest, market string, from, to uint64, verifiedCoverage *RangeCoverage) (MarketTrades, error) {
	fail := func() (MarketTrades, error) { return MarketTrades{}, ErrCandles }
	var err error
	var meme, quote, decimals, curve string
	var poolID *string
	err = tx.QueryRow(ctx, `SELECT m.payload->'values'->>'memeToken',m.payload->'values'->>'quoteAsset',q.payload->'values'->>'quoteDecimals',m.payload->'values'->>'curve',m.payload->'values'->>'poolId'
 FROM tickergarden.canonical_projection_rows m JOIN tickergarden.canonical_projection_rows q ON q.chain_id=m.chain_id AND q.table_name='configs' AND q.row_key='quote:'||(m.payload->'values'->>'quoteAssetConfigId')
 WHERE m.chain_id=$1 AND m.table_name='markets' AND m.row_key=$2 AND m.payload->>'marketId'=m.row_key AND q.payload->>'kind'='quote'
 AND q.payload->>'id'=m.payload->'values'->>'quoteAssetConfigId' AND q.payload->'values'->>'quoteAsset'=m.payload->'values'->>'quoteAsset'`, m.ChainID, market).Scan(&meme, &quote, &decimals, &curve, &poolID)
	if err != nil || !addressRE.MatchString(curve) {
		return fail()
	}
	d, err := strconv.ParseUint(decimals, 10, 8)
	if err != nil || strconv.FormatUint(d, 10) != decimals {
		return fail()
	}
	if d < 6 || d > 18 || !addressRE.MatchString(meme) || !addressRE.MatchString(quote) || meme == quote {
		return fail()
	}
	var coverage RangeCoverage
	if verifiedCoverage == nil {
		coverage, err = VerifyRangeCoverage(ctx, tx, m, from, to)
		if err != nil {
			return MarketTrades{}, err
		}
	} else {
		coverage = *verifiedCoverage
		if coverage.From != from || coverage.To != to {
			return fail()
		}
	}
	rows, err := tx.Query(ctx, `SELECT e.row_key,e.payload->>'signature' FROM tickergarden.canonical_projection_rows e
 JOIN tickergarden.chain_blocks b ON b.chain_id=e.chain_id AND b.hash=e.block_hash
 WHERE e.chain_id=$1 AND e.table_name='events' AND b.block_timestamp>=$2 AND b.block_timestamp<$3
 AND ((e.payload->'provenance'->>'emitter'=$4 AND e.payload->>'signature' IN ('CurveBuy(address,address,uint256,uint256,uint256,uint256)','CurveSell(address,address,uint256,uint256,uint256,uint256)'))
 OR (e.payload->'args'->>'id'=$5 AND e.payload->>'signature'='Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'))
 ORDER BY b.number,e.row_key LIMIT 10001`, m.ChainID, from, to, curve, poolID)
	if err != nil {
		return fail()
	}
	type candidate struct{ key, sig string }
	candidates := []candidate{}
	for rows.Next() {
		var c candidate
		if rows.Scan(&c.key, &c.sig) != nil {
			rows.Close()
			return fail()
		}
		candidates = append(candidates, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil || len(candidates) > 10000 {
		return fail()
	}
	items := make([]TradeActivity, 0, len(candidates))
	classified := map[string]map[string]string{}
	for _, c := range candidates {
		var item TradeActivity
		if c.sig == "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)" {
			o, e := loadPoolObservation(ctx, tx, m.ChainID, c.key)
			if e != nil {
				return fail()
			}
			labels, ok := classified[o.Source.TransactionHash]
			if !ok {
				links, e := loadConversionLinks(ctx, tx, m, o.Source.TransactionHash)
				if e != nil {
					return fail()
				}
				labels = map[string]string{}
				for _, link := range links {
					labels[link.SwapSource.EventKey] = link.Activity.Classification
				}
				classified[o.Source.TransactionHash] = labels
			}
			if label, ok := labels[c.key]; ok {
				o.Classification = label
			}
			item = poolActivity(o)
		} else {
			o, e := loadCurveObservation(ctx, tx, m.ChainID, c.key)
			if e != nil {
				return fail()
			}
			item = curveActivity(o)
		}
		if err != nil {
			return fail()
		}
		if item.MarketID != market || item.MemeAsset != meme || item.QuoteAsset != quote || item.QuoteDecimals != uint8(d) {
			return fail()
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		a, b := items[i].Source, items[j].Source
		an, _ := new(big.Int).SetString(a.BlockNumber, 10)
		bn, _ := new(big.Int).SetString(b.BlockNumber, 10)
		if c := an.Cmp(bn); c != 0 {
			return c > 0
		}
		if a.TransactionIndex != b.TransactionIndex {
			return a.TransactionIndex > b.TransactionIndex
		}
		return a.LogIndex > b.LogIndex
	})
	return MarketTrades{MarketID: market, MemeAsset: meme, QuoteAsset: quote, QuoteDecimals: uint8(d), Coverage: coverage, Items: items}, nil
}

type MarketTrades struct {
	MarketID      string          `json:"marketId"`
	MemeAsset     string          `json:"memeAsset"`
	QuoteAsset    string          `json:"quoteAsset"`
	QuoteDecimals uint8           `json:"quoteDecimals"`
	Coverage      RangeCoverage   `json:"coverage"`
	Items         []TradeActivity `json:"items"`
}

func LoadMarketCandles(ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, market string, from, to, interval uint64) (MarketCandles, error) {
	// Validate cheap range constraints before any database work.
	valid := map[uint64]bool{60: true, 300: true, 900: true, 3600: true, 14400: true, 86400: true}
	if !valid[interval] || from >= to || from%interval != 0 || to%interval != 0 || (to-from)/interval > 2000 {
		return MarketCandles{}, ErrCandles
	}
	executions, err := LoadMarketTrades(ctx, pool, m, market, from, to)
	if err != nil {
		return MarketCandles{}, err
	}
	r := CandleRange{ChainID: m.ChainID, MarketID: market, MemeAsset: executions.MemeAsset, QuoteAsset: executions.QuoteAsset, QuoteDecimals: executions.QuoteDecimals, From: from, To: to, Interval: interval}
	trades := make([]CandleTrade, 0, len(executions.Items))
	for _, o := range executions.Items {
		ts, e := strconv.ParseUint(o.Timestamp, 10, 64)
		if e != nil {
			return MarketCandles{}, ErrCandles
		}
		trades = append(trades, CandleTrade{Source: o.Source, Timestamp: ts, MarketID: o.MarketID, MemeAsset: o.MemeAsset, QuoteAsset: o.QuoteAsset, QuoteDecimals: o.QuoteDecimals, MemeRaw: o.MemeRaw, QuoteRaw: o.QuoteRaw, Classification: o.Classification})
	}
	series, err := BuildCandles(r, trades)
	if err != nil {
		return MarketCandles{}, err
	}
	return MarketCandles{MarketID: market, MemeAsset: r.MemeAsset, QuoteAsset: r.QuoteAsset, QuoteDecimals: r.QuoteDecimals, Interval: interval, Coverage: executions.Coverage, Series: series}, nil
}
