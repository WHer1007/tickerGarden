package analytics

import (
	"context"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

type StockIdentity struct {
	AssetUID      string `json:"assetUid"`
	StockToken    string `json:"stockToken"`
	StockDecimals uint8  `json:"stockDecimals"`
}
type GlobalTradeGroup struct {
	Binding string `json:"binding"`
	AssetTradeStats
}
type GlobalStatistics struct {
	Coverage             RangeCoverage      `json:"coverage"`
	MarketCount          uint64             `json:"marketCount"`
	RegisteredStockCount uint64             `json:"registeredStockCount"`
	BoundMarketCount     uint64             `json:"boundMarketCount"`
	UnboundMarketCount   uint64             `json:"unboundMarketCount"`
	Stocks               []StockIdentity    `json:"stocks"`
	Groups               []GlobalTradeGroup `json:"groups"`
}

// LoadGlobalStatistics reads the complete bounded directory and execution flows
// in one snapshot. Registration counts include retired STOCK configurations.
// A zero assetUid is an explicitly unbound market, never a registered STOCK.
// Counts describe the projection checkpoint; flows describe coverage [from,to).
func LoadGlobalStatistics(ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, from, to uint64) (GlobalStatistics, error) {
	out, _, err := loadGlobalSnapshot(ctx, pool, m, from, to)
	return out, err
}

func loadGlobalSnapshot(ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, from, to uint64) (GlobalStatistics, []AssetMarketTrades, error) {
	fail := func() (GlobalStatistics, []AssetMarketTrades, error) { return GlobalStatistics{}, nil, ErrAssetStats }
	if pool == nil {
		return fail()
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	coverage, err := VerifyRangeCoverage(ctx, tx, m, from, to)
	if err != nil {
		return GlobalStatistics{}, nil, err
	}
	zero := "0x" + strings.Repeat("0", 64)
	out := GlobalStatistics{Coverage: coverage, Stocks: []StockIdentity{}, Groups: []GlobalTradeGroup{}}
	stocks := map[string]bool{}
	rows, err := tx.Query(ctx, `SELECT row_key,payload->>'id',payload->'values'->>'assetUid',payload->'values'->>'stockToken',payload->'values'->>'tokenDecimals' FROM tickergarden.canonical_projection_rows WHERE chain_id=$1 AND table_name='configs' AND payload->>'kind'='asset' ORDER BY row_key LIMIT 1001`, m.ChainID)
	if err != nil {
		return fail()
	}
	for rows.Next() {
		var key, id, uid, token, decimals string
		if rows.Scan(&key, &id, &uid, &token, &decimals) != nil {
			rows.Close()
			return fail()
		}
		d, e := strconv.ParseUint(decimals, 10, 8)
		if !hashRE.MatchString(uid) || uid == zero || id != uid || key != "asset:"+uid || stocks[uid] || !addressRE.MatchString(token) || token == "0x"+strings.Repeat("0", 40) || e != nil || d > 18 || strconv.FormatUint(d, 10) != decimals {
			rows.Close()
			return fail()
		}
		stocks[uid] = true
		out.Stocks = append(out.Stocks, StockIdentity{uid, token, uint8(d)})
	}
	err = rows.Err()
	rows.Close()
	if err != nil || len(stocks) > 1000 {
		return fail()
	}
	out.RegisteredStockCount = uint64(len(stocks))
	rows, err = tx.Query(ctx, `SELECT row_key,payload->>'marketId',payload->'values'->>'assetUid' FROM tickergarden.canonical_projection_rows WHERE chain_id=$1 AND table_name='markets' ORDER BY row_key LIMIT 1001`, m.ChainID)
	if err != nil {
		return fail()
	}
	type binding struct{ market, asset string }
	markets := []binding{}
	for rows.Next() {
		var key, id, asset string
		if rows.Scan(&key, &id, &asset) != nil || key != id || !hashRE.MatchString(id) || !hashRE.MatchString(asset) || (asset != zero && !stocks[asset]) {
			rows.Close()
			return fail()
		}
		markets = append(markets, binding{id, asset})
		if asset == zero {
			out.UnboundMarketCount++
		} else {
			out.BoundMarketCount++
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil || len(markets) > 1000 {
		return fail()
	}
	out.MarketCount = uint64(len(markets))
	inputs := make([]AssetMarketTrades, 0, len(markets))
	count := 0
	for _, b := range markets {
		trades, e := loadMarketTrades(ctx, tx, m, b.market, from, to, &coverage)
		if e != nil {
			return GlobalStatistics{}, nil, e
		}
		count += len(trades.Items)
		if count > 100000 {
			return fail()
		}
		inputs = append(inputs, AssetMarketTrades{b.asset, trades})
	}
	groups, err := AggregateAssetTrades(m.ChainID, coverage, inputs)
	if err != nil {
		return fail()
	}
	for _, g := range groups {
		kind := "registered_stock"
		if g.AssetUID == zero {
			kind = "unbound"
		}
		out.Groups = append(out.Groups, GlobalTradeGroup{kind, g})
	}
	if err = tx.Commit(ctx); err != nil {
		return fail()
	}
	return out, inputs, nil
}
