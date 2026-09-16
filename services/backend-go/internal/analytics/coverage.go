package analytics

import (
	"context"
	"errors"
	"math"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
)

var ErrCoverage = errors.New("analytics interval is not completely projected")

type RangeCoverage struct {
	From             uint64 `json:"from"`
	To               uint64 `json:"to"`
	AnchorNumber     uint64 `json:"anchorNumber"`
	AnchorHash       string `json:"anchorHash"`
	ThroughNumber    uint64 `json:"throughNumber"`
	ThroughHash      string `json:"throughHash"`
	ProjectionNumber uint64 `json:"projectionNumber"`
	ProjectionHash   string `json:"projectionHash"`
}

// VerifyRangeCoverage must run in the SAME repeatable-read transaction as the
// trade query. The result is not a reusable authorization for another snapshot.
// A preceding block and a block at/after To bound the half-open interval.
func VerifyRangeCoverage(ctx context.Context, tx pgx.Tx, m deployment.Manifest, from, to uint64) (RangeCoverage, error) {
	fail := func() (RangeCoverage, error) { return RangeCoverage{}, ErrCoverage }
	if tx == nil || from >= to || to > math.MaxInt64 {
		return fail()
	}
	commitment, _, _, err := conversionManifest(m)
	if err != nil {
		return fail()
	}
	var start, tip uint64
	var tipHash string
	err = tx.QueryRow(ctx, `SELECT p.start_block,p.tip_number,p.tip_hash
 FROM tickergarden.projection_checkpoints p
 JOIN tickergarden.discovery_checkpoints d ON d.chain_id=p.chain_id
 JOIN tickergarden.chain_journal j ON j.chain_id=p.chain_id
 JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.tip_hash
 WHERE p.chain_id=$1 AND p.manifest_hash=$2 AND d.manifest_hash=$2 AND j.genesis_hash=$3
 AND d.start_block=p.start_block AND p.tip_number<=d.tip_number AND p.tip_number<=j.finalized_number
 AND b.number=p.tip_number AND b.canonical AND b.receipts_verified AND b.block_timestamp IS NOT NULL`, m.ChainID, commitment, m.GenesisHash).Scan(&start, &tip, &tipHash)
	if err != nil {
		return fail()
	}
	var left, right uint64
	err = tx.QueryRow(ctx, `SELECT number FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND number BETWEEN $2 AND $3 AND block_timestamp<$4 ORDER BY number DESC LIMIT 1`, m.ChainID, start, tip, from).Scan(&left)
	if err != nil {
		return fail()
	}
	err = tx.QueryRow(ctx, `SELECT number FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND number BETWEEN $2 AND $3 AND block_timestamp>=$4 ORDER BY number LIMIT 1`, m.ChainID, left, tip, to).Scan(&right)
	if err != nil || right <= left {
		return fail()
	}

	out := RangeCoverage{From: from, To: to, AnchorNumber: left, ThroughNumber: right, ProjectionNumber: tip, ProjectionHash: tipHash}
	var valid bool
	err = tx.QueryRow(ctx, `WITH ordered AS (
 SELECT number,hash,parent_hash,block_timestamp,receipts_verified,
 lag(number) OVER w AS previous_number,lag(hash) OVER w AS previous_hash,
 lag(block_timestamp) OVER w AS previous_time
 FROM tickergarden.chain_blocks
 WHERE chain_id=$1 AND canonical AND number BETWEEN $2 AND $3
 WINDOW w AS (ORDER BY number)
 ) SELECT
 count(*)::numeric=($3::numeric-$2::numeric+1)
 AND min(number)=$2 AND max(number)=$3
 AND COALESCE(bool_and(COALESCE(
 receipts_verified AND block_timestamp IS NOT NULL
 AND length(hash)=66 AND left(hash,2)='0x' AND translate(substr(hash,3),'0123456789abcdef','')=''
 AND length(parent_hash)=66 AND left(parent_hash,2)='0x' AND translate(substr(parent_hash,3),'0123456789abcdef','')=''
 AND CASE WHEN number=$2 THEN block_timestamp<$6
 ELSE number=previous_number+1 AND parent_hash=previous_hash AND block_timestamp>=previous_time END,
 false)),false),
 max(hash) FILTER (WHERE number=$4),max(hash) FILTER (WHERE number=$5)
 FROM ordered`, m.ChainID, start, tip, left, right, from).Scan(&valid, &out.AnchorHash, &out.ThroughHash)
	if err != nil || !valid || !hashRE.MatchString(out.AnchorHash) || !hashRE.MatchString(out.ThroughHash) {
		return fail()
	}
	return out, nil
}
