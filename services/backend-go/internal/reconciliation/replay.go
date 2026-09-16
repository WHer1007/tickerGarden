package reconciliation

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strconv"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/principal"
	"tickergarden/backend/internal/projection"
)

const MaxReplayInputs uint64 = 100000
const MaxReplayBytes = 64 << 20

// Verify against stored raw logs as well as the event checkpoint. This does not
// establish the completeness of RPC log collection or the deployment start.
func verifyReplay(ctx context.Context, tx pgx.Tx, chain, start, end, expected uint64, snapshot []byte) (uint64, error) {
	if expected > MaxReplayInputs {
		return 0, ErrEvidence
	}
	rows, e := tx.Query(ctx, `SELECT p.payload,p.digest,l.payload,b.number,b.hash,p.log_index
 FROM tickergarden.projection_inputs p
 JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.block_hash
 LEFT JOIN tickergarden.chain_logs l ON l.chain_id=p.chain_id AND l.block_hash=p.block_hash AND l.log_index=p.log_index
 WHERE p.chain_id=$1 AND b.canonical AND b.receipts_verified AND b.number BETWEEN $2 AND $3
 ORDER BY b.number,p.log_index LIMIT 100001`, chain, start, end)
	if e != nil {
		return 0, ErrEvidence
	}
	defer rows.Close()
	ledger := principal.New()
	var count uint64
	totalBytes := 0
	for rows.Next() {
		var raw, source []byte
		var digest, hash string
		var height, index uint64
		if rows.Scan(&raw, &digest, &source, &height, &hash, &index) != nil {
			return 0, ErrEvidence
		}
		count++
		totalBytes += len(raw) + len(source)
		if count > MaxReplayInputs || totalBytes > MaxReplayBytes {
			return 0, ErrEvidence
		}
		var input projection.Input
		var log chainrpc.Log
		if deployment.Hash(raw) != digest || json.Unmarshal(raw, &input) != nil || json.Unmarshal(source, &log) != nil || input.ChainID != chain || !reflect.DeepEqual(input.Log, log) || log.Removed || log.BlockHash != hash || log.BlockNumber != "0x"+strconv.FormatUint(height, 16) || log.LogIndex != "0x"+strconv.FormatUint(index, 16) {
			return 0, ErrEvidence
		}
		decoded, e := events.Decode(input.Module, log)
		if e != nil {
			return 0, ErrEvidence
		}
		if ledger.Apply(decoded) != nil {
			return 0, ErrEvidence
		}
	}
	if rows.Err() != nil || count != expected {
		return 0, ErrEvidence
	}
	rebuilt, e := ledger.Snapshot()
	if e != nil || !bytes.Equal(snapshot, rebuilt) {
		return 0, ErrEvidence
	}
	return count, nil
}
