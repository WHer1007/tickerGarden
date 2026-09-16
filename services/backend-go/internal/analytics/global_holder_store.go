package analytics

import (
	"context"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

// LoadGlobalHolderCounts binds all finalized market histories to one immutable
// transaction. Never sum independent per-market HTTP responses as a global count.
func LoadGlobalHolderCounts(ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest) (GlobalHolderCounts, error) {
	fail := func() (GlobalHolderCounts, error) { return GlobalHolderCounts{}, ErrHolders }
	if pool == nil {
		return fail()
	}
	commitment, _, _, err := conversionManifest(m)
	if err != nil {
		return fail()
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	var number uint64
	var hash string
	err = tx.QueryRow(ctx, `SELECT p.tip_number,p.tip_hash FROM tickergarden.projection_checkpoints p
 JOIN tickergarden.discovery_checkpoints d ON d.chain_id=p.chain_id JOIN tickergarden.chain_journal j ON j.chain_id=p.chain_id
 JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.tip_hash AND b.number=p.tip_number
 WHERE p.chain_id=$1 AND p.manifest_hash=$2 AND d.manifest_hash=$2 AND j.genesis_hash=$3 AND d.start_block=p.start_block AND p.tip_number<=d.tip_number AND p.tip_number<=j.finalized_number AND b.canonical AND b.receipts_verified`, m.ChainID, commitment, m.GenesisHash).Scan(&number, &hash)
	if err != nil {
		return fail()
	}
	rows, err := tx.Query(ctx, `SELECT d.market_id,d.payload->'state'->>'assetUid' FROM tickergarden.canonical_discovered_markets d JOIN tickergarden.chain_blocks b ON b.chain_id=d.chain_id AND b.hash=d.block_hash WHERE d.chain_id=$1 AND b.number<=$2 ORDER BY d.market_id LIMIT 1001`, m.ChainID, number)
	if err != nil {
		return fail()
	}
	type binding struct{ market, asset string }
	bindings := []binding{}
	seen := map[string]bool{}
	for rows.Next() {
		var b binding
		if rows.Scan(&b.market, &b.asset) != nil || !hashRE.MatchString(b.market) || !hashRE.MatchString(b.asset) || seen[b.market] {
			rows.Close()
			return fail()
		}
		seen[b.market] = true
		bindings = append(bindings, b)
	}
	err = rows.Err()
	rows.Close()
	if err != nil || len(bindings) > 1000 {
		return fail()
	}
	inputs := make([]AssetHolderSnapshot, 0, len(bindings))
	zero := "0x" + strings.Repeat("0", 64)
	var pairs uint64
	for _, b := range bindings {
		if b.asset != zero {
			var count int
			err = tx.QueryRow(ctx, `SELECT count(*) FROM tickergarden.canonical_projection_rows WHERE chain_id=$1 AND table_name='configs' AND row_key='asset:'||$2 AND payload->>'kind'='asset' AND payload->>'id'=$2 AND payload->'values'->>'assetUid'=$2`, m.ChainID, b.asset).Scan(&count)
			if err != nil || count != 1 {
				return fail()
			}
		}
		holders, e := loadMarketHolders(ctx, tx, m, b.market)
		if e != nil {
			return fail()
		}
		pairs += uint64(len(holders.Balances))
		if pairs > 1000000 {
			return fail()
		}
		inputs = append(inputs, AssetHolderSnapshot{b.asset, holders})
	}
	out, err := aggregateHolderSnapshots(ctx, strconv.FormatUint(number, 10), hash, inputs)
	if err != nil {
		return fail()
	}
	if err = tx.Commit(ctx); err != nil {
		return fail()
	}
	return out, nil
}
