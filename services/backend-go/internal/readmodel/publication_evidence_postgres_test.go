package readmodel

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/migration"
)

func publicationEvidenceDB(t *testing.T) (*pgxpool.Pool, *sql.DB) {
	t.Helper()
	if os.Getenv("TG_TEST_FINANCIAL_PUBLICATION") != "1" {
		t.Skip("set TG_TEST_FINANCIAL_PUBLICATION=1")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	t.Cleanup(cancel)
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close(context.Background()) })
	name := fmt.Sprintf("tg_financial_publication_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, err := admin.Exec(cleanup, "DROP DATABASE "+quoted+" WITH (FORCE)"); err != nil {
			t.Error(err)
		}
	})
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	cfg, err := pgx.ParseConfig(u.String())
	if err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { db.Close() })
	migrations, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = migrations.Up(ctx); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, db
}

func insertPublicationMarketSource(t *testing.T, db *sql.DB, candidate CandidateSet) {
	t.Helper()
	if len(candidate.Markets) != 1 {
		t.Fatal("publication fixture must contain exactly one market")
	}
	source := candidate.Markets[0].Source
	ctx := t.Context()
	if _, err := db.ExecContext(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES($1,$2,$3,$4,true)`, candidate.ChainID, source.BlockNumber, source.BlockHash, candidate.HistoryStartHash); err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(chainrpc.Log{BlockHash: source.BlockHash, BlockNumber: "0x" + source.BlockNumber, TransactionHash: source.TransactionHash, TransactionIndex: "0x0", LogIndex: "0x0"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,$3,$4,$5)`, candidate.ChainID, source.BlockHash, source.LogIndex, candidate.Markets[0].MemeToken, payload); err != nil {
		t.Fatal(err)
	}
}

func TestVerifiedPublicationPostgresAtomicity(t *testing.T) {
	pool, db := publicationEvidenceDB(t)
	candidate, head := minimalPublishableCandidate()
	manifest := "0x4444444444444444444444444444444444444444444444444444444444444444"
	snapshotRaw, evidenceRaw, err := AssemblePublication(candidate, manifest, head, publicationRPCSources(), completePublicationChecks(), nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx := t.Context()
	genesis := "0x" + strings.Repeat("f", 64)
	if _, err = db.ExecContext(ctx, `INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,1,10,$3,10,$3)`, candidate.ChainID, genesis, candidate.BlockHash); err != nil {
		t.Fatal(err)
	}
	insertPublicationMarketSource(t, db, candidate)
	if _, err = db.ExecContext(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES($1,10,$2,$3,true)`, candidate.ChainID, candidate.BlockHash, head.ParentHash); err != nil {
		t.Fatal(err)
	}
	store := Store{Pool: pool, ChainID: candidate.ChainID}
	if err = store.PublishVerified(ctx, snapshotRaw, evidenceRaw, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err = store.PublishVerified(ctx, snapshotRaw, evidenceRaw, time.Now()); err != nil {
		t.Fatal("idempotent retry failed", err)
	}
	var snapshots, evidenceRows int
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM tickergarden.read_snapshots`).Scan(&snapshots); err != nil || snapshots != 1 {
		t.Fatal("snapshot missing or duplicated", snapshots, err)
	}
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM tickergarden.read_snapshot_evidence`).Scan(&evidenceRows); err != nil || evidenceRows != 1 {
		t.Fatal("evidence missing or duplicated", evidenceRows, err)
	}
	var storedEvidenceDigest string
	if err = db.QueryRowContext(ctx, `SELECT evidence_digest FROM tickergarden.read_snapshot_evidence`).Scan(&storedEvidenceDigest); err != nil || storedEvidenceDigest != deployment.Hash(evidenceRaw) {
		t.Fatal("evidence digest mismatch", storedEvidenceDigest, err)
	}

	var proof PublicationEvidence
	if jsonErr := json.Unmarshal(evidenceRaw, &proof); jsonErr != nil {
		t.Fatal(jsonErr)
	}
	proof.ManifestHash = "0x5555555555555555555555555555555555555555555555555555555555555555"
	conflict, _ := json.Marshal(proof)
	if err = store.PublishVerified(ctx, snapshotRaw, conflict, time.Now()); err == nil {
		t.Fatal("accepted conflicting evidence for immutable revision")
	}
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM tickergarden.read_snapshot_evidence`).Scan(&evidenceRows); err != nil || evidenceRows != 1 {
		t.Fatal("conflict changed evidence", evidenceRows, err)
	}

	next, _ := minimalPublishableCandidate()
	next.BlockNumber = "11"
	next.BlockHash = "0x6666666666666666666666666666666666666666666666666666666666666666"
	next.FeeReconciliation.BlockNumber = next.BlockNumber
	next.FeeReconciliation.BlockHash = next.BlockHash
	nextHead := chainrpc.Header{Number: "0xb", Hash: next.BlockHash, ParentHash: candidate.BlockHash, Timestamp: "0x65"}
	nextSnapshot, nextEvidence, err := AssemblePublication(next, manifest, nextHead, publicationRPCSources(), completePublicationChecks(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES($1,11,$2,$3,true)`, next.ChainID, next.BlockHash, candidate.BlockHash); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `UPDATE tickergarden.chain_journal SET tip_number=11,tip_hash=$1,finalized_number=11,finalized_hash=$1,updated_at=now() WHERE chain_id=$2`, next.BlockHash, next.ChainID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `CREATE FUNCTION tickergarden.reject_publication_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejection'; END $$; CREATE TRIGGER reject_publication_evidence BEFORE INSERT ON tickergarden.read_snapshot_evidence FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_publication_evidence()`); err != nil {
		t.Fatal(err)
	}
	if err = store.PublishVerified(ctx, nextSnapshot, nextEvidence, time.Now()); err == nil {
		t.Fatal("publication survived evidence insert failure")
	}
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM tickergarden.read_snapshots`).Scan(&snapshots); err != nil || snapshots != 1 {
		t.Fatal("snapshot committed without evidence", snapshots, err)
	}
}

func TestVerifiedPublicationRejectsUnverifiedHeadPostgres(t *testing.T) {
	pool, db := publicationEvidenceDB(t)
	candidate, _ := minimalPublishableCandidate()
	headHash := "0x7777777777777777777777777777777777777777777777777777777777777777"
	head := chainrpc.Header{Number: "0xb", Hash: headHash, ParentHash: candidate.BlockHash, Timestamp: "0x65"}
	snapshotRaw, evidenceRaw, err := AssemblePublication(candidate, "0x4444444444444444444444444444444444444444444444444444444444444444", head, publicationRPCSources(), completePublicationChecks(), nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx := t.Context()
	genesis := "0x" + strings.Repeat("f", 64)
	if _, err = db.ExecContext(ctx, `INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,1,11,$3,11,$3)`, candidate.ChainID, genesis, headHash); err != nil {
		t.Fatal(err)
	}
	insertPublicationMarketSource(t, db, candidate)
	if _, err = db.ExecContext(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES($1,10,$2,$3,true),($1,11,$4,$2,false)`, candidate.ChainID, candidate.BlockHash, head.ParentHash, headHash); err != nil {
		t.Fatal(err)
	}
	store := Store{Pool: pool, ChainID: candidate.ChainID}
	if err = store.PublishVerified(ctx, snapshotRaw, evidenceRaw, time.Now()); err == nil {
		t.Fatal("published snapshot with an unverified head block")
	}
	if _, err = db.ExecContext(ctx, `UPDATE tickergarden.chain_blocks SET receipts_verified=true WHERE chain_id=$1 AND number=11`, candidate.ChainID); err != nil {
		t.Fatal(err)
	}
	if err = store.PublishVerified(ctx, snapshotRaw, evidenceRaw, time.Now()); err != nil {
		t.Fatal("verified head did not recover publication", err)
	}
}
