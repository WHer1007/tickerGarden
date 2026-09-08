package integration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"tickergarden/backend/internal/operations"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/analytics"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/journal"
)

type fixtureRPC struct {
	blocks        []chainrpc.Header
	final         int
	chain         uint64
	failLogs      bool
	duplicateLogs bool
	rootProof     bool
	badRootProof  bool
}

func hash(n int) string { return fmt.Sprintf("0x%064x", n) }
func block(n int, parent string, salt int) chainrpc.Header {
	return chainrpc.Header{Number: fmt.Sprintf("0x%x", n), Hash: hash(n + salt), ParentHash: parent, Timestamp: fmt.Sprintf("0x%x", 100+n)}
}
func (f *fixtureRPC) ChainID(context.Context) (uint64, error) { return f.chain, nil }
func (f *fixtureRPC) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	switch tag {
	case "latest":
		return f.blocks[len(f.blocks)-1], nil
	case "finalized":
		return f.blocks[f.final], nil
	}
	n, e := chainrpc.Quantity(tag)
	if e != nil || n >= uint64(len(f.blocks)) {
		return chainrpc.Header{}, errors.New("missing block")
	}
	return f.blocks[n], nil
}
func (f *fixtureRPC) Logs(_ context.Context, h chainrpc.Header) ([]chainrpc.Log, error) {
	if f.failLogs {
		return nil, errors.New("injected RPC failure")
	}
	logs := []chainrpc.Log{{Address: "0x0000000000000000000000000000000000000001", Topics: []string{}, Data: "0x", BlockNumber: h.Number, BlockHash: h.Hash, TransactionHash: hash(99), TransactionIndex: "0x0", LogIndex: "0x0"}}
	if f.duplicateLogs {
		logs = append(logs, logs[0])
	}
	return logs, nil
}
func testJournal(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	// A remote finalized head may stay ahead of a receipt-verifying indexer on a
	// fast chain. Locally ingested canonical ancestors must still become usable
	// by downstream workers one step at a time.
	const laggedChain = 421614
	// The migration harness inserts a scope-only row for this supported chain.
	// Replace that row with a complete fixture and remove the fixture afterwards.
	if _, err := pool.Exec(ctx, `DELETE FROM tickergarden.chain_journal WHERE chain_id=$1`, laggedChain); err != nil {
		t.Fatal("lagged finality fixture setup", err)
	}
	lagged := &fixtureRPC{chain: laggedChain, final: 2, blocks: []chainrpc.Header{block(0, hash(0), 200)}}
	for n := 1; n < 4; n++ {
		lagged.blocks = append(lagged.blocks, block(n, lagged.blocks[n-1].Hash, 200))
	}
	laggedWorker := journal.Indexer{Pool: pool, RPC: lagged, ChainID: laggedChain, StartBlock: 0, MaxReorg: 128}
	for want := uint64(0); want < 2; want++ {
		result, err := laggedWorker.Step(ctx)
		if err != nil || result.Action != "indexed" {
			t.Fatal("lagged finality indexing", result, err)
		}
		var finalized uint64
		var finalizedHash string
		if err = pool.QueryRow(ctx, `SELECT finalized_number,finalized_hash FROM tickergarden.chain_journal WHERE chain_id=$1`, laggedChain).Scan(&finalized, &finalizedHash); err != nil || finalized != want || finalizedHash != lagged.blocks[want].Hash {
			t.Fatal("lagged finalized ancestor did not advance", finalized, finalizedHash, err)
		}
	}
	for _, statement := range []string{
		`DELETE FROM tickergarden.chain_logs WHERE chain_id=421614`,
		`DELETE FROM tickergarden.chain_receipts WHERE chain_id=421614`,
		`DELETE FROM tickergarden.chain_blocks WHERE chain_id=421614`,
		`DELETE FROM tickergarden.chain_journal WHERE chain_id=421614`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatal("lagged finality fixture cleanup", err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block) VALUES(421614,'0xarbsepolia',0)`); err != nil {
		t.Fatal("lagged finality fixture scope restore", err)
	}
	rpc := &fixtureRPC{chain: 46630, blocks: []chainrpc.Header{block(0, hash(0), 10)}}
	for n := 1; n < 4; n++ {
		rpc.blocks = append(rpc.blocks, block(n, rpc.blocks[n-1].Hash, 10))
	}
	worker := journal.Indexer{Pool: pool, RPC: rpc, ChainID: 46630, StartBlock: 0, MaxReorg: 128}
	step := func(want string) {
		t.Helper()
		r, e := worker.Step(ctx)
		if e != nil || r.Action != want {
			t.Fatalf("step want=%s got=%+v err=%v", want, r, e)
		}
	}
	tip := func() uint64 {
		t.Helper()
		var n uint64
		if err := pool.QueryRow(ctx, "SELECT tip_number FROM tickergarden.chain_journal WHERE chain_id=46630").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	step("indexed")
	initialStatus, err := operations.Load(ctx, pool, 46630, 5, time.Hour)
	if err != nil || initialStatus.ReceiptRootMissing == nil || *initialStatus.ReceiptRootMissing != 1 {
		t.Fatal("missing root monitoring", initialStatus.ReceiptRootMissing, err)
	}
	checkTransfers := func(want bool) {
		t.Helper()
		tx, e := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(context.Background())
		got, e := analytics.ReadCommittedTransferRange(ctx, tx, 46630, "0x0000000000000000000000000000000000000001", 0, 0)
		if (e == nil) != want {
			t.Fatal("committed history result", got, e)
		}
		if want && (got == nil || len(got) != 0) {
			t.Fatal("non-Transfer log became transfer", got)
		}
	}
	checkTransfers(true)
	if _, e := pool.Exec(ctx, `DELETE FROM tickergarden.chain_receipts WHERE chain_id=46630 AND block_hash=$1`, rpc.blocks[0].Hash); e != nil {
		t.Fatal(e)
	}
	checkTransfers(false)
	obs, e := rpc.Observe(ctx, rpc.blocks[0])
	if e != nil {
		t.Fatal(e)
	}
	raw, e := json.Marshal(obs.Receipts[0])
	if e != nil {
		t.Fatal(e)
	}
	if _, e := pool.Exec(ctx, `INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES(46630,$1,$2,0,'0x1',$3)`, rpc.blocks[0].Hash, obs.Receipts[0].TransactionHash, raw); e != nil {
		t.Fatal(e)
	}
	checkTransfers(true)
	rpc.failLogs = true
	if _, e := worker.Step(ctx); e == nil || tip() != 0 {
		t.Fatal("RPC failure advanced cursor")
	}
	rpc.failLogs = false
	rpc.duplicateLogs = true
	if _, e := worker.Step(ctx); e == nil || tip() != 0 {
		t.Fatal("SQL insert failure advanced cursor")
	}
	var partial int
	if e := pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.chain_blocks").Scan(&partial); e != nil || partial != 1 {
		t.Fatal("failed SQL transaction left a partial block", e, partial)
	}
	rpc.duplicateLogs = false
	parent := rpc.blocks[1].ParentHash
	rpc.blocks[1].ParentHash = hash(500)
	if _, e := worker.Step(ctx); e == nil || tip() != 0 {
		t.Fatal("accepted broken parent chain")
	}
	rpc.blocks[1].ParentHash = parent
	for n := 1; n < 4; n++ {
		step("indexed")
	}
	step("idle")
	// Existing journals have NULL timestamps after migration, not fabricated time.
	if _, e := pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET block_timestamp=NULL WHERE chain_id=46630 AND number=2`); e != nil {
		t.Fatal(e)
	}
	rpc.failLogs = true
	if _, e := worker.Step(ctx); e == nil || tip() != 3 {
		t.Fatal("failed timestamp backfill advanced tip")
	}
	var observed *uint64
	if e := pool.QueryRow(ctx, `SELECT block_timestamp FROM tickergarden.chain_blocks WHERE chain_id=46630 AND number=2`).Scan(&observed); e != nil || observed != nil {
		t.Fatal("partial timestamp persisted", e)
	}
	rpc.failLogs = false
	step("receipts_verified")
	if e := pool.QueryRow(ctx, `SELECT block_timestamp FROM tickergarden.chain_blocks WHERE chain_id=46630 AND number=2`).Scan(&observed); e != nil || observed == nil || *observed != 102 || tip() != 3 {
		t.Fatal("timestamp backfill failed", e, observed)
	}
	if _, e := pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipts_verified=false WHERE chain_id=46630 AND number=2`); e != nil {
		t.Fatal(e)
	}
	savedTime := rpc.blocks[2].Timestamp
	rpc.blocks[2].Timestamp = "0x67"
	if _, e := worker.Step(ctx); e == nil || tip() != 3 {
		t.Fatal("silently overwrote timestamp commitment")
	}
	rpc.blocks[2].Timestamp = savedTime
	step("receipts_verified")
	if _, e := pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET block_timestamp=NULL WHERE chain_id=46630 AND number=2`); e != nil {
		t.Fatal(e)
	}
	rpc.blocks[2].Timestamp = "0x63"
	if _, e := worker.Step(ctx); e == nil || tip() != 3 {
		t.Fatal("non-monotonic historical time accepted")
	}
	rpc.blocks[2].Timestamp = savedTime
	step("receipts_verified")

	// Legacy receipt commitments require re-observation, not trusting existing rows.
	if _, e := pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipt_count=NULL,receipt_set_hash=NULL WHERE chain_id=46630 AND number=2`); e != nil {
		t.Fatal(e)
	}
	step("receipts_verified")
	var committedCount int
	var committedHash string
	if e := pool.QueryRow(ctx, `SELECT receipt_count,receipt_set_hash FROM tickergarden.chain_blocks WHERE chain_id=46630 AND number=2`).Scan(&committedCount, &committedHash); e != nil || committedCount != 1 || tip() != 3 {
		t.Fatal("receipt commitment backfill failed", e)
	}
	observation, e := rpc.Observe(ctx, rpc.blocks[2])
	if e != nil {
		t.Fatal(e)
	}
	expectedHash, e := chainrpc.ReceiptSetCommitment(observation.Receipts)
	if e != nil || expectedHash != committedHash {
		t.Fatal("wrong receipt commitment", e)
	}
	if _, e := pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1,receipts_verified=false WHERE chain_id=46630 AND number=2`, "sha256:"+strings.Repeat("0", 64)); e != nil {
		t.Fatal(e)
	}
	if _, e := worker.Step(ctx); e == nil {
		t.Fatal("overwrote conflicting receipt commitment")
	}
	if _, e := pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1,receipts_verified=true WHERE chain_id=46630 AND number=2`, committedHash); e != nil {
		t.Fatal(e)
	}
	// Upgrading an old journal checks receipts without advancing its tip.
	if _, e := pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipts_verified=false WHERE chain_id=46630 AND number=2`); e != nil {
		t.Fatal(e)
	}
	step("receipts_verified")
	if tip() != 3 {
		t.Fatal("backfill moved chain tip")
	}
	var receiptCount int
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.chain_receipts`).Scan(&receiptCount); e != nil || receiptCount != 4 {
		t.Fatal("receipt persistence incomplete", e, receiptCount)
	}
	if _, e := pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipts_verified=false WHERE chain_id=46630 AND number=2`); e != nil {
		t.Fatal(e)
	}
	if _, e := pool.Exec(ctx, `DELETE FROM tickergarden.chain_logs WHERE chain_id=46630 AND block_hash=$1`, rpc.blocks[2].Hash); e != nil {
		t.Fatal(e)
	}
	if _, e := worker.Step(ctx); e == nil || tip() != 3 {
		t.Fatal("backfill silently repaired inconsistent historical logs")
	}
	historical, _ := rpc.Logs(ctx, rpc.blocks[2])
	payload, _ := json.Marshal(historical[0])
	if _, e := pool.Exec(ctx, `INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES(46630,$1,0,$2,$3)`, rpc.blocks[2].Hash, historical[0].Address, payload); e != nil {
		t.Fatal(e)
	}
	step("receipts_verified")
	// A fresh worker uses the stored cursor and does not duplicate logs.
	restarted := worker
	worker = restarted
	step("idle")
	var count int
	if e := pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.chain_logs").Scan(&count); e != nil || count != 4 {
		t.Fatalf("logs count %d error %v", count, e)
	}
	// A second process holding the chain lease prevents concurrent writes.
	conn, e := pool.Acquire(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = conn.Exec(ctx, "SELECT pg_advisory_lock(730046630)"); e != nil {
		t.Fatal(e)
	}
	step("busy")
	if _, e = conn.Exec(ctx, "SELECT pg_advisory_unlock(730046630)"); e != nil {
		t.Fatal(e)
	}
	conn.Release()
	// Replace the last two unfinalized blocks; preserve old blocks and logs.
	for n := 2; n < 4; n++ {
		rpc.blocks[n] = block(n, rpc.blocks[n-1].Hash, 20)
	}
	worker.MaxReorg = 1
	if _, e := worker.Step(ctx); e == nil || tip() != 3 {
		t.Fatal("exceeded reorg limit changed checkpoint")
	}
	worker.MaxReorg = 128
	step("rewound")
	if tip() != 1 {
		t.Fatal("wrong reorg ancestor")
	}
	step("indexed")
	step("indexed")
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.chain_blocks WHERE NOT canonical").Scan(&count); e != nil || count != 2 {
		t.Fatal("orphan audit history missing", e, count)
	}
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE b.canonical").Scan(&count); e != nil || count != 4 {
		t.Fatal("canonical log view is incorrect", e, count)
	}
	rpc.final = 2
	step("idle")
	// Finality violations, chain mismatch and changed range are hard failures.
	saved := rpc.blocks[2]
	rpc.blocks[2] = block(2, rpc.blocks[1].Hash, 30)
	if _, e = worker.Step(ctx); e == nil || tip() != 3 {
		t.Fatal("accepted finalized reorg")
	}
	rpc.blocks[2] = saved
	rpc.chain = 4663
	if _, e = worker.Step(ctx); e == nil {
		t.Fatal("accepted wrong chain")
	}
	rpc.chain = 46630
	worker.StartBlock = 1
	if _, e = worker.Step(ctx); e == nil {
		t.Fatal("accepted changed start")
	}
	worker.StartBlock = 0
	savedGenesis := rpc.blocks[0]
	rpc.blocks[0] = block(0, hash(0), 40)
	if _, e = worker.Step(ctx); e == nil {
		t.Fatal("accepted different genesis")
	}
	rpc.blocks[0] = savedGenesis
	// A regressed finalized tag must leave all canonical data intact.
	rpc.final = 0 // A regressed finalized tag itself must fail, without erasure.
	if _, e = worker.Step(ctx); e == nil || tip() != 3 {
		t.Fatal("accepted finality regression")
	}
	rpc.final = 2
	step("idle")
	// Synthetic evidence tests persistence and backfill, not cryptography.
	worker.RequireReceiptRoot = true
	if _, err := worker.Step(ctx); err == nil || tip() != 3 {
		t.Fatal("missing root evidence accepted", err)
	}
	rpc.rootProof, rpc.badRootProof = true, true
	if _, err := worker.Step(ctx); err == nil || tip() != 3 {
		t.Fatal("mismatched root evidence accepted", err)
	}
	rpc.badRootProof = false
	for n := 0; n < 4; n++ {
		result, err := worker.Step(ctx)
		if err != nil || result.Action != "receipts_verified" || result.BlockNumber == nil || *result.BlockNumber != uint64(n) || tip() != 3 {
			t.Fatal("root backfill", result, err)
		}
	}
	step("idle")
	monitored, err := operations.Load(ctx, pool, 46630, 5, time.Hour)
	if err != nil || monitored.ReceiptRootMissing == nil || *monitored.ReceiptRootMissing != 0 {
		t.Fatal("completed root monitoring", monitored.ReceiptRootMissing, err)
	}
	var proven int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.chain_blocks WHERE chain_id=46630 AND canonical AND receipts_root=$1 AND root_receipt_set_hash=receipt_set_hash`, hash(555)).Scan(&proven); err != nil || proven != 4 {
		t.Fatal("root evidence persistence", proven, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1 WHERE chain_id=46630 AND canonical`, "sha256:"+strings.Repeat("0", 64)); err == nil {
		t.Fatal("DB accepted stale root evidence")
	}
}

func (f *fixtureRPC) Observe(ctx context.Context, h chainrpc.Header) (chainrpc.Observation, error) {
	logs, e := f.Logs(ctx, h)
	if e != nil {
		return chainrpc.Observation{}, e
	}
	observation := chainrpc.Observation{Logs: logs, Receipts: []chainrpc.Receipt{{TransactionHash: hash(99), TransactionIndex: "0x0", BlockHash: h.Hash, BlockNumber: h.Number, Status: "0x1", Logs: logs}}}
	if f.rootProof {
		commitment, _ := chainrpc.ReceiptSetCommitment(observation.Receipts)
		observation.RootProof = &chainrpc.ReceiptRootVerification{BlockHash: h.Hash, ReceiptRoot: hash(555), ReceiptCount: 1, ReceiptSetHash: commitment}
		if f.badRootProof {
			observation.RootProof.ReceiptSetHash = "sha256:" + strings.Repeat("0", 64)
		}
	}
	return observation, nil
}
