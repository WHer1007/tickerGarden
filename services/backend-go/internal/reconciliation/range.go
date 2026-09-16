package reconciliation

import (
	"context"
	"strconv"

	"github.com/jackc/pgx/v5"
)

const MaxRangeBlocks uint64 = 1000000

// RangeCoverage is coverage of the configured stored range, not proof that the
// configured start predates deployment or that RPC supplied every historical log.
type RangeCoverage struct {
	CompleteReceiptsVerified       bool   `json:"completeReceiptsVerified"`
	ReceiptRootsVerified           bool   `json:"receiptRootsVerified"`
	EventReplayVerified            bool   `json:"eventReplayVerified"`
	ReplayedInputs                 string `json:"replayedInputs"`
	StartBlock                     string `json:"startBlock"`
	EndBlock                       string `json:"endBlock"`
	BlockCount                     uint64 `json:"blockCount"`
	JournalContinuous              bool   `json:"journalContinuous"`
	PrincipalCheckpointsContinuous bool   `json:"principalCheckpointsContinuous"`
	DeploymentStartVerified        bool   `json:"deploymentStartVerified"`
}

func verifyRange(ctx context.Context, tx pgx.Tx, chain, start, end uint64, endHash string) (RangeCoverage, error) {
	if end < start || end-start >= MaxRangeBlocks {
		return RangeCoverage{}, ErrEvidence
	}
	rows, e := tx.Query(ctx, `SELECT b.number,b.hash,b.parent_hash,b.block_timestamp,b.receipts_verified,c.block_hash,c.parent_hash
 FROM tickergarden.chain_blocks b LEFT JOIN tickergarden.principal_checkpoints c ON c.chain_id=b.chain_id AND c.block_hash=b.hash
 WHERE b.chain_id=$1 AND b.canonical AND b.number BETWEEN $2 AND $3 ORDER BY b.number LIMIT 1000001`, chain, start, end)
	if e != nil {
		return RangeCoverage{}, ErrEvidence
	}
	defer rows.Close()
	var previous string
	var priorTime uint64
	var count uint64
	for rows.Next() {
		var height uint64
		var hash, parent string
		var timestamp *uint64
		var receipts bool
		var checkpoint, checkpointParent *string
		if rows.Scan(&height, &hash, &parent, &timestamp, &receipts, &checkpoint, &checkpointParent) != nil || height != start+count || !hashPattern.MatchString(hash) || !hashPattern.MatchString(parent) || timestamp == nil || !receipts || checkpoint == nil || *checkpoint != hash {
			return RangeCoverage{}, ErrEvidence
		}
		if count == 0 {
			if checkpointParent != nil {
				return RangeCoverage{}, ErrEvidence
			}
		} else if parent != previous || checkpointParent == nil || *checkpointParent != previous || *timestamp < priorTime {
			return RangeCoverage{}, ErrEvidence
		}
		count++
		previous = hash
		priorTime = *timestamp
	}
	if rows.Err() != nil || count != end-start+1 || previous != endHash {
		return RangeCoverage{}, ErrEvidence
	}
	return RangeCoverage{StartBlock: strconv.FormatUint(start, 10), EndBlock: strconv.FormatUint(end, 10), BlockCount: count, JournalContinuous: true, PrincipalCheckpointsContinuous: true}, nil
}
