package integration

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projector"
	"tickergarden/backend/internal/useractivity"
)

func testProjectorActivityBackfill(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	rpc := emptyFixture()
	rpc.m.ChainID = 421614
	rpc.m.GenesisHash = hash(900)
	emitter := "0x" + strings.Repeat("1", 40)
	rpc.m.Contracts = append(rpc.m.Contracts, deployment.Contract{Module: "UserStockVault", Address: emitter, RuntimeCodeHash: deployment.Hash([]byte{0})})
	rpc.headers["0x0"] = chainrpc.Header{Number: "0x0", Hash: rpc.m.GenesisHash, ParentHash: hash(0), Timestamp: "0x0"}
	sort.Slice(rpc.m.Contracts, func(i, j int) bool { return rpc.m.Contracts[i].Address < rpc.m.Contracts[j].Address })
	manifestRaw, err := json.Marshal(rpc.m)
	if err != nil {
		t.Fatal(err)
	}
	manifestHash := deployment.Hash(manifestRaw)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	// Keep all cleanup scoped to this chain; child rows are removed first.
	defer func() {
		exec(`DELETE FROM tickergarden.projection_inputs WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.projection_rows WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.projection_checkpoints WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.user_activity_records WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.user_activity_blocks WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.discovery_batches WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_receipts WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_logs WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.discovery_checkpoints WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_blocks WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_journal WHERE chain_id=421614`)
	}()
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(421614,$1,1,4,$2,4,$2)`, rpc.m.GenesisHash, hash(4))
	emptyDigest, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{})
	for n := 1; n <= 4; n++ {
		bh := hash(n)
		digest := emptyDigest
		var raw []byte
		if n == 1 {
			log := chainrpc.Log{Address: emitter, BlockNumber: "0x1", BlockHash: bh, TransactionHash: hash(810), TransactionIndex: "0x0", LogIndex: "0x0", Topics: []string{deployment.Hash([]byte("StockDeposited(bytes32,address,uint256)")), hash(820), "0x" + strings.Repeat("0", 24) + strings.Repeat("2", 40)}, Data: "0x" + strings.Repeat("0", 63) + "7"}
			r := chainrpc.Receipt{BlockNumber: "0x1", BlockHash: bh, TransactionHash: hash(810), TransactionIndex: "0x0", Status: "0x1", Logs: []chainrpc.Log{log}}
			raw, _ = json.Marshal(r)
			digest, _ = chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{r})
		}
		parent := hash(n - 1)
		if n == 1 {
			parent = rpc.m.GenesisHash
		}
		count := 0
		if n == 1 {
			count = 1
		}
		exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified,receipt_count,receipt_set_hash) VALUES(421614,$1,$2,$3,$4,true,$5,$6)`, n, bh, parent, n+100, count, digest)
		if raw != nil {
			exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES(421614,$1,$2,0,'0x1',$3)`, bh, hash(810), raw)
		}
	}
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES(421614,$1,1,4,$2)`, manifestHash, hash(4))
	for n := 1; n <= 4; n++ {
		exec(`INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES(421614,$1)`, hash(n))
	}
	// Seed a later business view before replaying old activity. Its asset ID
	// must not be sent to the historical Registry for block 1.
	exec(`INSERT INTO tickergarden.projection_checkpoints(chain_id,manifest_hash,projector_version,start_block,tip_number,tip_hash,input_count) VALUES(421614,$1,'sentinel',1,2,$2,99)`, manifestHash, hash(2))
	exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(421614,'configs','future-asset',jsonb_build_object('kind','asset','id',$1::text),$2)`, hash(999), hash(2))
	worker := &projector.Worker{Pool: pool, RPC: rpc, Manifest: rpc.m, StartBlock: 1}
	res, err := worker.BackfillActivity(ctx)
	if err != nil || res.Action != "activity_backfilled" {
		t.Fatalf("first backfill: %+v %v", res, err)
	}
	res, err = worker.BackfillActivity(ctx)
	if err != nil || res.Action != "activity_backfilled" {
		t.Fatalf("second backfill: %+v %v", res, err)
	}
	var blocks, records int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.user_activity_blocks WHERE chain_id=421614`).Scan(&blocks); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.user_activity_records WHERE chain_id=421614`).Scan(&records); err != nil {
		t.Fatal(err)
	}
	if blocks != 2 || records != 1 {
		t.Fatalf("activity counts blocks=%d records=%d", blocks, records)
	}
	var before string
	if err = pool.QueryRow(ctx, `SELECT row_to_json(p)::text FROM tickergarden.projection_checkpoints p WHERE chain_id=421614`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	res, err = worker.BackfillActivity(ctx)
	if err != nil || res.Action != "activity_backfilled" {
		t.Fatalf("resume: %+v %v", res, err)
	}
	var after string
	if err = pool.QueryRow(ctx, `SELECT row_to_json(p)::text FROM tickergarden.projection_checkpoints p WHERE chain_id=421614`).Scan(&after); err != nil || after != before {
		t.Fatalf("checkpoint changed: %q %q %v", before, after, err)
	}
	step := func(action string, height uint64) {
		t.Helper()
		result, e := worker.BackfillActivity(ctx)
		if e != nil || result.Action != action || (action == "activity_backfilled" && (result.BlockNumber == nil || *result.BlockNumber != height)) {
			t.Fatalf("step: %+v %v", result, e)
		}
	}
	step("activity_backfilled", 4)
	step("idle", 0)
	var stable string
	if err = pool.QueryRow(ctx, `SELECT row_to_json(a)::text FROM tickergarden.user_activity_blocks a WHERE chain_id=421614 AND block_hash=$1`, hash(4)).Scan(&stable); err != nil {
		t.Fatal(err)
	}
	// An obsolete first batch must be repaired before later matching batches.
	exec(`UPDATE tickergarden.user_activity_blocks SET extractor_version='old' WHERE chain_id=421614 AND block_hash=$1`, hash(1))
	rpc.fail = "code"
	if _, err = worker.BackfillActivity(ctx); err == nil {
		t.Fatal("invalid historical runtime accepted")
	}
	var version string
	if err = pool.QueryRow(ctx, `SELECT extractor_version FROM tickergarden.user_activity_blocks WHERE chain_id=421614 AND block_hash=$1`, hash(1)).Scan(&version); err != nil || version != "old" {
		t.Fatal("failed backfill changed batch", err)
	}
	rpc.fail = ""
	// A writer lease prevents concurrent backfill work.
	lease, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Rollback(context.Background())
	if _, err = lease.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, int64(750000000+421614)); err != nil {
		t.Fatal(err)
	}
	step("busy", 0)
	if err = lease.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	// Fail after the batch replacement, while activity records are copied.
	exec(`CREATE FUNCTION tickergarden.reject_activity_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$`)
	exec(`CREATE TRIGGER reject_activity_fixture BEFORE INSERT ON tickergarden.user_activity_records FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_activity_fixture()`)
	if _, err = worker.BackfillActivity(ctx); err == nil {
		t.Fatal("record write failure accepted")
	}
	if err = pool.QueryRow(ctx, `SELECT extractor_version FROM tickergarden.user_activity_blocks WHERE chain_id=421614 AND block_hash=$1`, hash(1)).Scan(&version); err != nil || version != "old" {
		t.Fatal("partial replacement committed", err)
	}
	exec(`DROP TRIGGER reject_activity_fixture ON tickergarden.user_activity_records`)
	exec(`DROP FUNCTION tickergarden.reject_activity_fixture()`)
	step("activity_backfilled", 1)
	// Completion cannot hide missing source/discovery intervals or broken ancestry.
	exec(`DELETE FROM tickergarden.discovery_batches WHERE chain_id=421614 AND block_hash=$1`, hash(2))
	if _, err = worker.BackfillActivity(ctx); err == nil {
		t.Fatal("discovery gap accepted")
	}
	exec(`INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES(421614,$1)`, hash(2))
	exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=421614 AND number=2`)
	if _, err = worker.BackfillActivity(ctx); err == nil {
		t.Fatal("canonical gap accepted")
	}
	exec(`UPDATE tickergarden.chain_blocks SET canonical=true,parent_hash=$1 WHERE chain_id=421614 AND number=2`, hash(999))
	if _, err = worker.BackfillActivity(ctx); err == nil {
		t.Fatal("parent mismatch accepted")
	}
	exec(`UPDATE tickergarden.chain_blocks SET parent_hash=$1 WHERE chain_id=421614 AND number=2`, hash(1))
	step("idle", 0)
	var unchanged string
	if err = pool.QueryRow(ctx, `SELECT row_to_json(a)::text FROM tickergarden.user_activity_blocks a WHERE chain_id=421614 AND block_hash=$1`, hash(4)).Scan(&unchanged); err != nil || unchanged != stable {
		t.Fatal("matching batch changed", err)
	}
	if err = pool.QueryRow(ctx, `SELECT row_to_json(p)::text FROM tickergarden.projection_checkpoints p WHERE chain_id=421614`).Scan(&after); err != nil || after != before {
		t.Fatal("business checkpoint changed", err)
	}

	// The repaired history must pass the independent full receipt/activity reader.
	reader := useractivity.Store{Pool: pool, ChainID: 421614, GenesisHash: rpc.m.GenesisHash, ManifestHash: manifestHash, StartBlock: 1}
	page, err := reader.Load(ctx, "0x"+strings.Repeat("2", 40), 50, "")
	if err != nil || len(page.Items) != 1 || page.Items[0].Arguments["amount"] != "7" {
		t.Fatalf("repaired history unreadable: %+v %v", page, err)
	}

}
