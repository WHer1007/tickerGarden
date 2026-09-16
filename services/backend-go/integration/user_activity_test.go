package integration

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/useractivity"
)

type activityIdentityRPC struct{ block string }

func (o activityIdentityRPC) ChainID(context.Context) (uint64, error) { return 421614, nil }
func (o activityIdentityRPC) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	h := o.block
	if tag == "0x0" {
		h = hash(800)
	}
	return chainrpc.Header{Number: tag, Hash: h}, nil
}
func (o activityIdentityRPC) CodeAt(context.Context, string, string) ([]byte, error) {
	return []byte{0}, nil
}

func testUserActivity(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(421614,$1,1,1,$2,1,$2)`, hash(800), hash(801))
	defer func() {
		exec(`DELETE FROM tickergarden.chain_receipts WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_blocks WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_journal WHERE chain_id=421614`)
	}()
	emitter := "0x" + strings.Repeat("1", 40)
	account := "0x" + strings.Repeat("2", 40)
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 421614, GenesisHash: hash(800), Contracts: []deployment.Contract{{Module: "UserStockVault", Address: emitter, RuntimeCodeHash: deployment.Hash([]byte{0})}}}
	seed := func(block string) {
		log := chainrpc.Log{Address: emitter, BlockNumber: "0x1", BlockHash: block, TransactionHash: hash(810), TransactionIndex: "0x0", LogIndex: "0x0", Topics: []string{deployment.Hash([]byte("StockDeposited(bytes32,address,uint256)")), hash(820), "0x" + strings.Repeat("0", 24) + account[2:]}, Data: "0x" + strings.Repeat("0", 63) + "7"}
		receipt := chainrpc.Receipt{BlockNumber: "0x1", BlockHash: block, TransactionHash: hash(810), TransactionIndex: "0x0", Status: "0x1", Logs: []chainrpc.Log{log}}
		raw, _ := json.Marshal(receipt)
		digest, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
		exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified,receipt_count,receipt_set_hash) VALUES(421614,1,$1,$2,true,1,$3)`, block, hash(800), digest)
		exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES(421614,$1,$2,0,'0x1',$3)`, block, hash(810), raw)
	}
	seed(hash(801))
	index := func(block string, commit bool) error {
		header := chainrpc.Header{Number: "0x1", Hash: block}
		verified, err := deployment.Verify(ctx, activityIdentityRPC{block}, manifest, header)
		if err != nil {
			return err
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		if err = useractivity.IndexBlock(ctx, tx, 421614, header, hash(899), verified); err != nil {
			return err
		}
		if commit {
			return tx.Commit(ctx)
		}
		return nil
	}
	counts := func(want int) {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.user_activity_records WHERE chain_id=421614`).Scan(&n); err != nil || n != want {
			t.Fatalf("records %d want %d: %v", n, want, err)
		}
	}
	if err := index(hash(801), false); err != nil {
		t.Fatal(err)
	}
	counts(0)
	for range 2 {
		if err := index(hash(801), true); err != nil {
			t.Fatal(err)
		}
	}
	counts(1)
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT payload FROM tickergarden.user_activity_records WHERE chain_id=421614`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var record useractivity.Record
	if json.Unmarshal(raw, &record) != nil || record.Account != account || record.Arguments["amount"] != "7" {
		t.Fatal(string(raw))
	}
	// A post-observation receipt mutation cannot replace an already verified index.
	exec(`UPDATE tickergarden.chain_receipts SET payload=jsonb_set(payload,'{logs,0,data}',to_jsonb($1::text)) WHERE chain_id=421614`, "0x"+strings.Repeat("0", 63)+"8")
	if err := index(hash(801), true); err == nil {
		t.Fatal("mutated commitment accepted")
	}
	counts(1)
	exec(`UPDATE tickergarden.chain_receipts SET payload=jsonb_set(payload,'{logs,0,data}',to_jsonb($1::text)) WHERE chain_id=421614`, "0x"+strings.Repeat("0", 63)+"7")
	exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=421614`)
	if err := index(hash(801), true); err == nil {
		t.Fatal("orphan accepted")
	}
	seed(hash(802))
	exec(`UPDATE tickergarden.chain_journal SET tip_hash=$1,finalized_hash=$1 WHERE chain_id=421614`, hash(802))
	if err := index(hash(802), true); err != nil {
		t.Fatal(err)
	}
	counts(2)
	var canonical int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.user_activity_records r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=421614 AND b.canonical`).Scan(&canonical); err != nil || canonical != 1 {
		t.Fatal(canonical, err)
	}
	exec(`DELETE FROM tickergarden.chain_receipts WHERE chain_id=421614 AND block_hash=$1`, hash(801))
	exec(`DELETE FROM tickergarden.chain_blocks WHERE chain_id=421614 AND hash=$1`, hash(801))
	counts(1)
}
