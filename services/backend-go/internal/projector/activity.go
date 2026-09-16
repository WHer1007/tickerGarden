package projector

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/useractivity"
)

// Check the complete discovery interval before choosing a batch. A missing
// source block or discovery batch must never be reported as completed history.
func nextActivityBlock(ctx context.Context, tx pgx.Tx, chain, start, end uint64, manifest, genesis string) (uint64, bool, error) {
	if end < start || end-start >= 1000000 {
		return 0, false, errors.New("activity backfill range exceeds budget")
	}
	rows, err := tx.Query(ctx, `SELECT b.number,b.hash,b.parent_hash,d.block_hash IS NOT NULL,
 a.block_hash IS NOT NULL AND a.manifest_hash=$4 AND a.extractor_version=$5 AND a.receipt_set_hash=b.receipt_set_hash
 FROM tickergarden.chain_blocks b
 LEFT JOIN tickergarden.discovery_batches d ON d.chain_id=b.chain_id AND d.block_hash=b.hash
 LEFT JOIN tickergarden.user_activity_blocks a ON a.chain_id=b.chain_id AND a.block_hash=b.hash
 WHERE b.chain_id=$1 AND b.number BETWEEN $2 AND $3 AND b.canonical AND b.events_verified ORDER BY b.number`, chain, start, end, manifest, useractivity.Version)
	if err != nil {
		return 0, false, err
	}
	defer rows.Close()
	expected, candidate := start, uint64(0)
	pending := false
	previous := ""
	for rows.Next() {
		var n uint64
		var hash, parent string
		var discovered, complete bool
		if err = rows.Scan(&n, &hash, &parent, &discovered, &complete); err != nil {
			return 0, false, err
		}
		if n != expected || !discovered || (previous != "" && parent != previous) || (n == 0 && hash != genesis) || (n == 1 && parent != genesis) {
			return 0, false, errors.New("activity backfill discovery interval incomplete")
		}
		if !complete && !pending {
			candidate, pending = n, true
		}
		previous, expected = hash, expected+1
	}
	if err = rows.Err(); err != nil {
		return 0, false, err
	}
	if expected != end+1 {
		return 0, false, errors.New("activity backfill source interval incomplete")
	}
	return candidate, pending, nil
}
