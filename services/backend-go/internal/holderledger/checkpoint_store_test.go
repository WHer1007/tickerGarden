package holderledger

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/migration"
	"time"
)

func checkpointDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if os.Getenv("TG_TEST_HOLDER_CHECKPOINT") != "1" {
		t.Skip("set TG_TEST_HOLDER_CHECKPOINT=1 and TG_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	cfg, e := pgx.ParseConfig(os.Getenv("TG_TEST_DATABASE_URL"))
	if e != nil {
		t.Fatal("invalid test database")
	}
	admin, e := pgx.ConnectConfig(ctx, cfg)
	if e != nil {
		t.Fatal("test database unavailable")
	}
	t.Cleanup(func() { admin.Close(ctx) })
	name := fmt.Sprintf("tg_holder_checkpoint_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, e = admin.Exec(ctx, "CREATE DATABASE "+quoted); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		_, e := admin.Exec(ctx, "DROP DATABASE "+quoted+" WITH (FORCE)")
		if e != nil {
			t.Error(e)
		}
	})
	cfg = cfg.Copy()
	cfg.Database = name
	db := stdlib.OpenDB(*cfg)
	defer db.Close()
	m, e := migration.New(db)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = m.Up(ctx); e != nil {
		t.Fatal(e)
	}
	pc, e := pgxpool.ParseConfig(cfg.ConnString())
	if e != nil {
		t.Fatal(e)
	}
	pc.ConnConfig = cfg
	pc.MaxConns = 4
	p, e := pgxpool.NewWithConfig(ctx, pc)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(p.Close)
	return p
}

type checkpointBarrierRPC struct {
	*replayRPC
	barrier *sync.WaitGroup
}

func (r checkpointBarrierRPC) AuthenticatedTransactions(ctx context.Context, id uint64, h string) (chainrpc.TransactionBlock, error) {
	r.barrier.Done()
	r.barrier.Wait()
	return r.replayRPC.AuthenticatedTransactions(ctx, id, h)
}

type resumedRPC struct {
	*replayRPC
	genesis chainrpc.Header
}

func (r resumedRPC) Header(ctx context.Context, tag string) (chainrpc.Header, error) {
	if tag == "0x0" {
		return r.genesis, nil
	}
	return r.replayRPC.Header(ctx, tag)
}

func TestCheckpointPostgresRecovery(t *testing.T) {
	pool := checkpointDB(t)
	ctx := t.Context()
	store := CheckpointStore{pool}
	l, f, c := replayCase(t)
	scope := CheckpointScope{Config: c, MarketID: l.MarketID, Token: l.Token}
	key, _ := scopeKey(scope)
	if e := store.Initialize(ctx, scope, f.parent, l); e != nil {
		t.Fatal(e)
	}
	if e := store.Initialize(ctx, scope, f.parent, l); e == nil {
		t.Fatal("reset accepted")
	}
	initial, _, digest, e := store.Load(ctx, scope)
	if e != nil || initial.Revision != 0 {
		t.Fatal(e)
	}
	var barrier sync.WaitGroup
	barrier.Add(2)
	var workers sync.WaitGroup
	var wins atomic.Int32
	for range 2 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			_, rpc, _ := replayCase(t)
			_, e := store.Advance(ctx, checkpointBarrierRPC{rpc, &barrier}, scope, rpc.block)
			if e == nil {
				wins.Add(1)
			}
		}()
	}
	workers.Wait()
	if wins.Load() != 1 {
		t.Fatalf("CAS winners %d", wins.Load())
	}
	restored, state, newDigest, e := (CheckpointStore{pool}).Load(ctx, scope)
	if e != nil || restored.Revision != 1 || restored.ParentDigest != digest || newDigest == digest || restored.Replay == nil || restored.HistoryVerified || restored.PublicationEligible {
		t.Fatalf("bad restore %+v %v", restored, e)
	}
	// Failed duplicate/old block cannot advance the recovered head.
	if _, e = store.Advance(ctx, f, scope, f.block); e == nil {
		t.Fatal("duplicate advanced")
	}
	again, _, same, e := store.Load(ctx, scope)
	if e != nil || same != newDigest || again.Revision != 1 {
		t.Fatal("failed replay mutated head")
	}
	if e = state.Apply(Action{Kind: "checkpoint", Timestamp: 2}); e != nil {
		t.Fatal(e)
	}
	// Persisted state is isolated from mutation of returned objects.
	_, unchanged, _, e := store.Load(ctx, scope)
	if e != nil || unchanged.UpdatedAt != 1 {
		t.Fatal("mutable stored state")
	}
	// Resume a second block from the stored state through a fresh Store.
	_, nextRPC, _ := replayCase(t)
	genesis := nextRPC.parent
	nextRPC.parent = f.block
	nextRPC.block = chainrpc.Header{Number: "0x2", Timestamp: "0x2", Hash: "0x" + strings.Repeat("d", 64), ParentHash: f.block.Hash}
	nextRPC.txs.Header = nextRPC.block
	for i := range nextRPC.observation.Receipts {
		nextRPC.observation.Receipts[i].BlockHash = nextRPC.block.Hash
		nextRPC.observation.Receipts[i].BlockNumber = nextRPC.block.Number
	}
	nextRPC.observation.RootProof.BlockHash = nextRPC.block.Hash
	nextRPC.observation.RootProof.ReceiptSetHash, _ = chainrpc.ReceiptSetCommitment(nextRPC.observation.Receipts)
	if _, e = (CheckpointStore{pool}).Advance(ctx, resumedRPC{nextRPC, genesis}, scope, nextRPC.block); e != nil {
		t.Fatal("resume", e)
	}
	latest, _, _, e := store.Load(ctx, scope)
	if e != nil || latest.Revision != 2 {
		t.Fatal("resume head", e)
	}
	var evidenceRows int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.holder_replay_evidence WHERE scope_digest=$1`, key).Scan(&evidenceRows); e != nil || evidenceRows != 2 {
		t.Fatal("replay evidence was not committed with checkpoints", evidenceRows, e)
	}
	if audit, state, auditErr := store.AuditHistory(ctx, scope); !errors.Is(auditErr, ErrCheckpointAudit) || state != nil || audit != (CheckpointAudit{}) {
		t.Fatal("parsed-only test evidence passed raw-root audit", auditErr)
	}
	wrong := scope
	wrong.Config.ChainID++
	if _, _, _, e = store.Load(ctx, wrong); e == nil {
		t.Fatal("cross-chain recovery")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.holder_replay_checkpoints SET payload=$1 WHERE scope_digest=$2 AND revision=2`, []byte(`{}`), key); e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = store.Load(ctx, scope); e == nil {
		t.Fatal("accepted corrupt state")
	}
}

func TestAuthenticatedCheckpointPostgres(t *testing.T) {
	pool := checkpointDB(t)
	store := CheckpointStore{pool}
	rpc, config := seedCase(t)
	ledger, seed, evidence, err := AuthenticatePristineSeedWithEvidence(t.Context(), rpc, config, rpc.block)
	if err != nil {
		t.Fatal(err)
	}
	scope := config.Scope
	if err := store.InitializeAuthenticatedEvidence(t.Context(), scope, rpc.block, ledger, seed, evidence); err != nil {
		t.Fatal(err)
	}
	stored, _, _, err := store.Load(t.Context(), scope)
	if err != nil || stored.Seed == nil || *stored.Seed != seed || stored.HistoryVerified || stored.PublicationEligible {
		t.Fatalf("authenticated seed provenance lost: %+v %v", stored, err)
	}
	audit, audited, err := store.AuditHistory(t.Context(), scope)
	if err != nil || audited == nil || audit.Revisions != 1 || !audit.AuthenticatedSeed || !audit.CheckpointChainValid || !audit.RawRootsReverified || !audit.EvidenceReplayValid || audit.HistoryVerified || audit.PublicationEligible {
		t.Fatalf("raw seed evidence audit failed: %+v %v", audit, err)
	}
}

func TestCheckpointAuditRejectsProvisionalSeed(t *testing.T) {
	pool := checkpointDB(t)
	store := CheckpointStore{pool}
	ledger, rpc, config := replayCase(t)
	scope := CheckpointScope{Config: config, MarketID: ledger.MarketID, Token: ledger.Token}
	if err := store.Initialize(t.Context(), scope, rpc.block, ledger); err != nil {
		t.Fatal(err)
	}
	if audit, state, err := store.AuditHistory(t.Context(), scope); !errors.Is(err, ErrCheckpointAudit) || state != nil || audit != (CheckpointAudit{}) {
		t.Fatalf("provisional seed passed history audit: %+v %v", audit, err)
	}
}
