package rewards

import (
	"context"
	"github.com/jackc/pgx/v5"
)

// verifyJournalRange proves continuity of the configured stored range only. Its
// first parent is outside that range and is not a deployment-start proof.
func verifyJournalRange(ctx context.Context, tx pgx.Tx, chain, start, end uint64, endHash string) error {
	if end < start || end-start >= 1000000 {
		return ErrUnavailable
	}
	rows, e := tx.Query(ctx, `SELECT number,hash,parent_hash,block_timestamp,receipts_verified FROM tickergarden.chain_blocks
 WHERE chain_id=$1 AND canonical AND number BETWEEN $2 AND $3 ORDER BY number LIMIT 1000001`, chain, start, end)
	if e != nil {
		return ErrUnavailable
	}
	defer rows.Close()
	var count, priorTime uint64
	var previous string
	for rows.Next() {
		var height uint64
		var h, parent string
		var timestamp *uint64
		var receipts bool
		if rows.Scan(&height, &h, &parent, &timestamp, &receipts) != nil || height != start+count || !hash.MatchString(h) || !hash.MatchString(parent) || timestamp == nil || !receipts {
			return ErrUnavailable
		}
		if count > 0 && (parent != previous || *timestamp < priorTime) {
			return ErrUnavailable
		}
		count++
		previous = h
		priorTime = *timestamp
	}
	if rows.Err() != nil || count != end-start+1 || previous != endHash {
		return ErrUnavailable
	}
	return nil
}
