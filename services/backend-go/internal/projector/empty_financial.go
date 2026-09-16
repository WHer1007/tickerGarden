package projector

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
)

// emptyFinancialEnd selects a bounded, receipt-verified and discovered interval
// containing no candidate-emitter logs. It does NOT publish or copy balances:
// the normal worker must perform all financial observations at the returned end.
func (w *Worker) emptyFinancialEnd(ctx context.Context, tx pgx.Tx, chain uint64, first chainrpc.Header, ceiling uint64) (chainrpc.Header, error) {
	n, err := first.Height()
	if err != nil {
		return first, err
	}
	candidates, err := w.candidateEmitters(ctx, tx, chain, ceiling)
	if err != nil {
		return first, err
	}
	rows, err := tx.Query(ctx, `SELECT b.number,b.hash,b.parent_hash,b.block_timestamp,EXISTS(SELECT 1 FROM tickergarden.chain_logs l WHERE l.chain_id=b.chain_id AND l.block_hash=b.hash AND l.address=ANY($4::text[])) FROM tickergarden.chain_blocks b JOIN tickergarden.discovery_batches d ON d.chain_id=b.chain_id AND d.block_hash=b.hash WHERE b.chain_id=$1 AND b.number BETWEEN $2 AND $3 AND b.canonical AND b.events_verified ORDER BY b.number`, chain, n, ceiling, candidates)
	if err != nil {
		return first, err
	}
	defer rows.Close()
	expected, previous, last := n, first.ParentHash, first
	for rows.Next() {
		var height, stamp uint64
		var hash, parent string
		var relevant bool
		if err = rows.Scan(&height, &hash, &parent, &stamp, &relevant); err != nil {
			return first, err
		}
		if height != expected || parent != previous {
			return first, errors.New("financial empty range is not contiguous")
		}
		if height == n && (hash != first.Hash || fmt.Sprintf("0x%x", stamp) != first.Timestamp) {
			return first, errors.New("financial first block changed")
		}
		if relevant {
			break
		}
		last = chainrpc.Header{Number: fmt.Sprintf("0x%x", height), Hash: hash, ParentHash: parent, Timestamp: fmt.Sprintf("0x%x", stamp)}
		previous = hash
		expected++
	}
	if rows.Err() != nil {
		return first, rows.Err()
	}
	return last, nil
}
