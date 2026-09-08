package operations

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrStatus = errors.New("backend status unavailable")

func Load(ctx context.Context, pool *pgxpool.Pool, chain, maxLag uint64, maxAge time.Duration) (Status, error) {
	if (chain != 4663 && chain != 46630 && chain != 421614) || maxAge <= 0 {
		return Status{}, ErrStatus
	}
	tx, e := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return Status{}, ErrStatus
	}
	defer tx.Rollback(ctx)
	var locked bool
	if tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock_shared($1)`, int64(730000000+chain)).Scan(&locked) != nil || !locked {
		return Status{}, ErrStatus
	}
	s := Status{ChainID: chain, Stages: []Stage{{Name: "journal"}, {Name: "discovery"}, {Name: "projection"}, {Name: "publication"}}, Alerts: []string{}}
	var finalized *uint64
	var discoveryManifest, projectionManifest *string
	e = tx.QueryRow(ctx, `SELECT transaction_timestamp(),j.genesis_hash,j.finalized_hash,j.finalized_number,COALESCE(fb.canonical AND fb.receipts_verified AND fb.number=j.finalized_number,false),j.updated_at,j.tip_number,
 COALESCE(jb.canonical AND jb.receipts_verified AND jb.number=j.tip_number,false),
 d.tip_number,COALESCE(db.canonical AND db.receipts_verified AND db.number=d.tip_number,false),
 p.tip_number,COALESCE(pb.canonical AND pb.receipts_verified AND pb.number=p.tip_number,false),d.manifest_hash,p.manifest_hash
 FROM tickergarden.chain_journal j
 LEFT JOIN tickergarden.chain_blocks fb ON fb.chain_id=j.chain_id AND fb.hash=j.finalized_hash
 LEFT JOIN tickergarden.chain_blocks jb ON jb.chain_id=j.chain_id AND jb.hash=j.tip_hash
 LEFT JOIN tickergarden.discovery_checkpoints d ON d.chain_id=j.chain_id
 LEFT JOIN tickergarden.chain_blocks db ON db.chain_id=d.chain_id AND db.hash=d.tip_hash
 LEFT JOIN tickergarden.projection_checkpoints p ON p.chain_id=j.chain_id
 LEFT JOIN tickergarden.chain_blocks pb ON pb.chain_id=p.chain_id AND pb.hash=p.tip_hash
 WHERE j.chain_id=$1`, chain).Scan(&s.ObservedAt, &s.GenesisHash, &s.StoredFinalizedHash, &finalized, &s.FinalizedCanonical, &s.LastJournalProgress, &s.Stages[0].Height, &s.Stages[0].Canonical, &s.Stages[1].Height, &s.Stages[1].Canonical, &s.Stages[2].Height, &s.Stages[2].Canonical, &discoveryManifest, &projectionManifest)
	if errors.Is(e, pgx.ErrNoRows) {
		if tx.QueryRow(ctx, `SELECT transaction_timestamp()`).Scan(&s.ObservedAt) != nil {
			return Status{}, ErrStatus
		}
	} else if e != nil {
		return Status{}, ErrStatus
	}
	if discoveryManifest != nil && projectionManifest != nil && *discoveryManifest != *projectionManifest {
		s.Alerts = append(s.Alerts, "projection_manifest_mismatch")
	}
	e = tx.QueryRow(ctx, `SELECT r.block_number,COALESCE(b.canonical AND b.receipts_verified AND b.number=r.block_number,false) FROM tickergarden.read_snapshots r LEFT JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=$1 ORDER BY r.block_number DESC LIMIT 1`, chain).Scan(&s.Stages[3].Height, &s.Stages[3].Canonical)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return Status{}, ErrStatus
	}
	e = tx.QueryRow(ctx, `SELECT r.failed_count,r.missing_count FROM tickergarden.canonical_reconciliation_runs r JOIN tickergarden.projection_checkpoints p ON p.chain_id=r.chain_id AND p.tip_hash=r.block_hash WHERE r.chain_id=$1 AND r.scope='vault-principal-v3'`, chain).Scan(&s.PrincipalFailed, &s.PrincipalMissing)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return Status{}, ErrStatus
	}
	if s.Stages[0].Height != nil {
		if tx.QueryRow(ctx, `SELECT count(*) FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND receipts_root IS NULL`, chain).Scan(&s.ReceiptRootMissing) != nil {
			return Status{}, ErrStatus
		}
	}
	if tx.Commit(ctx) != nil {
		return Status{}, ErrStatus
	}
	return Evaluate(s, finalized, maxLag, maxAge), nil
}
