package analytics

import (
	"context"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

type AssetStatistics struct {
	AssetUID      string            `json:"assetUid"`
	StockToken    string            `json:"stockToken"`
	StockDecimals uint8             `json:"stockDecimals"`
	Coverage      RangeCoverage     `json:"coverage"`
	Groups        []AssetTradeStats `json:"groups"`
}

// LoadAssetStatistics resolves a registered STOCK and every projected market
// bound to it. Historical retired assets remain queryable. This reports flows,
// not reserves, balances, holders, or USD totals.
func LoadAssetStatistics(ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, asset string, from, to uint64) (AssetStatistics, error) {
	fail := func() (AssetStatistics, error) { return AssetStatistics{}, ErrAssetStats }
	if pool == nil || !hashRE.MatchString(asset) {
		return fail()
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	coverage, err := VerifyRangeCoverage(ctx, tx, m, from, to)
	if err != nil {
		return AssetStatistics{}, err
	}
	var token, decimals string
	err = tx.QueryRow(ctx, `SELECT payload->'values'->>'stockToken',payload->'values'->>'tokenDecimals'
 FROM tickergarden.canonical_projection_rows WHERE chain_id=$1 AND table_name='configs' AND row_key='asset:'||$2
 AND payload->>'kind'='asset' AND payload->>'id'=$2 AND payload->'values'->>'assetUid'=$2`, m.ChainID, asset).Scan(&token, &decimals)
	d, e := strconv.ParseUint(decimals, 10, 8)
	if err != nil || e != nil || strconv.FormatUint(d, 10) != decimals || d > 18 || !addressRE.MatchString(token) || token == "0x"+strings.Repeat("0", 40) {
		return fail()
	}
	rows, err := tx.Query(ctx, `SELECT row_key,payload->>'marketId' FROM tickergarden.canonical_projection_rows
 WHERE chain_id=$1 AND table_name='markets' AND payload->'values'->>'assetUid'=$2 ORDER BY row_key LIMIT 1001`, m.ChainID, asset)
	if err != nil {
		return fail()
	}
	markets := []string{}
	for rows.Next() {
		var key, id string
		if rows.Scan(&key, &id) != nil || key != id || !hashRE.MatchString(key) {
			rows.Close()
			return fail()
		}
		markets = append(markets, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil || len(markets) > 1000 {
		return fail()
	}
	inputs := make([]AssetMarketTrades, 0, len(markets))
	count := 0
	for _, id := range markets {
		trades, e := loadMarketTrades(ctx, tx, m, id, from, to, &coverage)
		if e != nil {
			return AssetStatistics{}, e
		}
		count += len(trades.Items)
		if count > 100000 {
			return fail()
		}
		inputs = append(inputs, AssetMarketTrades{AssetUID: asset, Trades: trades})
	}
	groups, err := AggregateAssetTrades(m.ChainID, coverage, inputs)
	if err != nil {
		return fail()
	}
	if err = tx.Commit(ctx); err != nil {
		return fail()
	}
	return AssetStatistics{AssetUID: asset, StockToken: token, StockDecimals: uint8(d), Coverage: coverage, Groups: groups}, nil
}
