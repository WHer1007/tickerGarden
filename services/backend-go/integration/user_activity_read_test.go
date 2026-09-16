package integration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/readmodel"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/useractivity"
)

func testUserActivityRead(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	genesis, manifestHash := hash(800), hash(899)
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(421614,$1,1,2,$2,2,$2)`, genesis, hash(802))
	defer func() {
		exec(`DELETE FROM tickergarden.chain_receipts WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_blocks WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_journal WHERE chain_id=421614`)
	}()
	emitter := "0x" + strings.Repeat("1", 40)
	a, b := "0x"+strings.Repeat("2", 40), "0x"+strings.Repeat("3", 40)
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 421614, GenesisHash: genesis, Contracts: []deployment.Contract{{Module: "UserStockVault", Address: emitter, RuntimeCodeHash: deployment.Hash([]byte{0})}}}
	seed := func(number uint64, block, account string, amount byte) {
		hexNumber := fmt.Sprintf("0x%x", number)
		log := chainrpc.Log{Address: emitter, BlockNumber: hexNumber, BlockHash: block, TransactionHash: hash(int(810 + number)), TransactionIndex: "0x0", LogIndex: "0x0", Topics: []string{deployment.Hash([]byte("StockDeposited(bytes32,address,uint256)")), hash(int(820 + number)), "0x" + strings.Repeat("0", 24) + account[2:]}, Data: "0x" + strings.Repeat("0", 63) + string([]byte{'0' + amount})}
		receipt := chainrpc.Receipt{BlockNumber: hexNumber, BlockHash: block, TransactionHash: hash(int(810 + number)), TransactionIndex: "0x0", Status: "0x1", Logs: []chainrpc.Log{log}}
		if number == 2 {
			extra := log
			extra.LogIndex = "0x1"
			extra.Data = "0x" + strings.Repeat("0", 63) + "9"
			receipt.Logs = append(receipt.Logs, extra)
		}
		raw, _ := json.Marshal(receipt)
		digest, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
		parent := genesis
		if number > 1 {
			parent = hash(int(800 + number - 1))
		}
		exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified,receipt_count,receipt_set_hash) VALUES(421614,$1,$2,$3,true,1,$4)`, number, block, parent, digest)
		exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES(421614,$1,$2,0,'0x1',$3)`, block, hash(int(810+number)), raw)
	}
	seed(1, hash(801), a, 7)
	seed(2, hash(802), a, 8)
	index := func(number uint64, block string) {
		h := chainrpc.Header{Number: fmt.Sprintf("0x%x", number), Hash: block}
		v, err := deployment.Verify(ctx, activityIdentityRPC{block}, manifest, h)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if err = useractivity.IndexBlock(ctx, tx, 421614, h, manifestHash, v); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	index(1, hash(801))
	index(2, hash(802))
	store := useractivity.Store{Pool: pool, ChainID: 421614, GenesisHash: genesis, ManifestHash: manifestHash, StartBlock: 1}
	p1, err := store.Load(ctx, a, 1, "")
	if err != nil || len(p1.Items) != 1 || p1.Items[0].Arguments["amount"] != "9" || p1.NextCursor == nil {
		t.Fatalf("first page: %+v %v", p1, err)
	}
	p2, err := store.Load(ctx, a, 1, *p1.NextCursor)
	if err != nil || len(p2.Items) != 1 || p2.Items[0].Arguments["amount"] != "8" || p2.NextCursor == nil {
		t.Fatalf("second page: %+v %v", p2, err)
	}
	p3, err := store.Load(ctx, a, 1, *p2.NextCursor)
	if err != nil || len(p3.Items) != 1 || p3.Items[0].Arguments["amount"] != "7" || p3.NextCursor != nil || p1.Items[0].ID == p2.Items[0].ID {
		t.Fatalf("third page: %+v %v", p3, err)
	}
	if empty, err := store.Load(ctx, b, 10, ""); err != nil || len(empty.Items) != 0 {
		t.Fatalf("other account: %+v %v", empty, err)
	}
	if _, err = store.Load(ctx, b, 1, *p1.NextCursor); !errors.Is(err, useractivity.ErrCursor) {
		t.Fatalf("cross-account cursor: %v", err)
	}
	handler := httpapi.New(httpapi.Options{ChainID: 421614, Activities: &store})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/v1/users/"+a+"/activity?limit=1", nil))
	if response.Code != 200 || readmodel.ValidateResponse("UserActivityPage", response.Body.Bytes()) != nil {
		t.Fatalf("HTTP activity: %d %s", response.Code, response.Body.String())
	}
	testFrontendAnalyticsHTTP(t, handler, "activity", a)
	old := *p1.NextCursor
	// Add a finalized empty block through the real indexer; this changes the revision.
	emptyBlock := hash(803)
	emptyDigest, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{})
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified,receipt_count,receipt_set_hash) VALUES(421614,3,$1,$2,true,0,$3)`, emptyBlock, hash(802), emptyDigest)
	exec(`UPDATE tickergarden.chain_journal SET tip_number=3,tip_hash=$1,finalized_number=3,finalized_hash=$1 WHERE chain_id=421614`, emptyBlock)
	if _, err = store.Load(ctx, b, 10, ""); !errors.Is(err, useractivity.ErrEvidence) {
		t.Fatalf("missing empty block batch: %v", err)
	}
	index(3, emptyBlock)
	if _, err = store.Load(ctx, a, 1, old); !errors.Is(err, useractivity.ErrRevision) {
		t.Fatalf("old cursor after empty block: %v", err)
	}
	testFrontendAnalyticsHTTP(t, handler, "activity-changed", a, old)
	exec(`UPDATE tickergarden.user_activity_records SET payload=jsonb_set(payload,'{arguments,amount}','"123"') WHERE chain_id=421614 AND block_hash=$1 AND log_index=0`, hash(801))
	if _, err = store.Load(ctx, b, 10, ""); !errors.Is(err, useractivity.ErrEvidence) {
		t.Fatalf("other account record tamper: %v", err)
	}
	index(1, hash(801))
	exec(`UPDATE tickergarden.user_activity_blocks SET extractor_version='old' WHERE chain_id=421614 AND block_hash=$1`, hash(801))
	if _, err = store.Load(ctx, a, 10, ""); !errors.Is(err, useractivity.ErrEvidence) {
		t.Fatalf("version mismatch: %v", err)
	}
	index(1, hash(801))
	// Receipt payload and stored manifest/version are evidence, so corruption must fail closed.
	exec(`UPDATE tickergarden.chain_receipts SET payload=jsonb_set(payload,'{logs,0,data}',to_jsonb($1::text)) WHERE chain_id=421614 AND block_hash=$2`, "0x"+strings.Repeat("0", 63)+"9", hash(802))
	if _, err = store.Load(ctx, a, 10, ""); !errors.Is(err, useractivity.ErrEvidence) {
		t.Fatalf("receipt tamper: %v", err)
	}
	exec(`UPDATE tickergarden.chain_receipts SET payload=jsonb_set(payload,'{logs,0,data}',to_jsonb($1::text)) WHERE chain_id=421614 AND block_hash=$2`, "0x"+strings.Repeat("0", 63)+"8", hash(802))
	for _, bad := range []string{"%%%", "e30", old + "="} {
		if _, e := store.Load(ctx, a, 10, bad); !errors.Is(e, useractivity.ErrCursor) {
			t.Fatalf("bad cursor %q: %v", bad, e)
		}
	}
	exec(`UPDATE tickergarden.chain_journal SET updated_at=now()-interval '121 seconds' WHERE chain_id=421614`)
	if _, e := store.Load(ctx, a, 10, ""); !errors.Is(e, useractivity.ErrEvidence) {
		t.Fatalf("stale journal: %v", e)
	}
	exec(`UPDATE tickergarden.chain_journal SET updated_at=now() WHERE chain_id=421614`)
	exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=421614 AND hash=$1`, hash(801))
	if _, e := store.Load(ctx, a, 10, ""); !errors.Is(e, useractivity.ErrEvidence) {
		t.Fatalf("orphaned range: %v", e)
	}
	exec(`UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=421614 AND hash=$1`, hash(801))
	exec(`DELETE FROM tickergarden.user_activity_records WHERE chain_id=421614 AND block_hash=$1`, hash(801))
	if _, e := store.Load(ctx, b, 10, ""); !errors.Is(e, useractivity.ErrEvidence) {
		t.Fatalf("missing activity: %v", e)
	}
	index(1, hash(801))
	exec(`UPDATE tickergarden.user_activity_blocks SET manifest_hash=$1 WHERE chain_id=421614 AND block_hash=$2`, hash(898), hash(801))
	if _, err = store.Load(ctx, a, 10, ""); !errors.Is(err, useractivity.ErrEvidence) {
		t.Fatalf("manifest tamper: %v", err)
	}
}
