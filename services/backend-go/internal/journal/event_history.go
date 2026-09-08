package journal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
)

// VerifyStoredEventExclusions supplements VerifyStoredReceiptHistory: every
// non-root block must have a hash-bound negative bloom for the independently
// reconstructed emitter inventory. It never returns full receipt-root coverage.
func VerifyStoredEventExclusions(ctx context.Context, tx pgx.Tx, chain, start, end uint64, emitters map[string]uint64) (bool, error) {
	bad := errors.New("project event history coverage unavailable")
	if len(emitters) == 0 || end < start || end-start >= 1000000 {
		return false, bad
	}
	rows, err := tx.Query(ctx, `SELECT number,hash,parent_hash,block_timestamp,event_exclusion_header FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND number BETWEEN $2 AND $3 AND receipts_root IS NULL ORDER BY number`, chain, start, end)
	if err != nil {
		return false, bad
	}
	defer rows.Close()
	for rows.Next() {
		var n, t uint64
		var hash, parent string
		var raw []byte
		if rows.Scan(&n, &hash, &parent, &t, &raw) != nil {
			return false, bad
		}
		selected := []string{}
		for a, from := range emitters {
			if from <= n {
				selected = append(selected, a)
			}
		}
		var h chainrpc.Header
		if json.Unmarshal(raw, &h) != nil || h.Number != fmt.Sprintf("0x%x", n) || h.ParentHash != parent || h.Timestamp != fmt.Sprintf("0x%x", t) || chainrpc.VerifyEventExclusion(raw, hash, selected) != nil {
			return false, nil
		}
	}
	if rows.Err() != nil {
		return false, bad
	}
	return true, nil
}
