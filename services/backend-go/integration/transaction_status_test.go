package integration

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/transactions"
)

func testTransactionStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(421614,$1,1,2,$2,1,$3)`, hash(500), hash(502), hash(501))
	defer func() {
		exec(`DELETE FROM tickergarden.chain_receipts WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_blocks WHERE chain_id=421614`)
		exec(`DELETE FROM tickergarden.chain_journal WHERE chain_id=421614`)
	}()
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES(421614,1,$1,$2,true),(421614,2,$3,$1,true)`, hash(501), hash(500), hash(502))
	add := func(block, status string) {
		r := chainrpc.Receipt{TransactionHash: hash(550), TransactionIndex: "0x0", BlockNumber: "0x2", BlockHash: block, Status: status, Logs: []chainrpc.Log{}}
		raw, _ := json.Marshal(r)
		digest, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{r})
		exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES(421614,$1,$2,0,$3,$4)`, block, hash(550), status, raw)
		exec(`UPDATE tickergarden.chain_blocks SET receipt_count=1,receipt_set_hash=$1 WHERE chain_id=421614 AND hash=$2`, digest, block)
	}
	add(hash(502), "0x1")
	store := &transactions.Store{Pool: pool, ChainID: 421614, GenesisHash: hash(500)}
	check := func(state string, orphans int) {
		t.Helper()
		got, err := store.Load(ctx, hash(550))
		if err != nil || got.State != state || len(got.OrphanedReceipts) != orphans || got.Source != "indexed_journal" || got.PendingLookup != "not_performed" {
			t.Fatal(got, err)
		}
	}
	check("confirmed", 0)
	exec(`UPDATE tickergarden.chain_journal SET finalized_number=2,finalized_hash=$1 WHERE chain_id=421614`, hash(502))
	check("finalized", 0)
	exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=421614 AND hash=$1`, hash(502))
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES(421614,2,$1,$2,true)`, hash(503), hash(501))
	exec(`UPDATE tickergarden.chain_journal SET tip_hash=$1,finalized_number=1,finalized_hash=$2 WHERE chain_id=421614`, hash(503), hash(501))
	check("reorged", 1)
	add(hash(503), "0x0")
	check("confirmed", 1)
	got, err := store.Load(ctx, hash(550))
	if err != nil || got.Receipt.Execution != "reverted" || got.Confirmations != "1" {
		t.Fatal(got, err)
	}
	testTransactionHTTP(t, ctx, pool, store)
	unknown, err := store.Load(ctx, hash(551))
	if err != nil || unknown.State != "unknown" || unknown.Receipt != nil {
		t.Fatal(unknown, err)
	}
	store.GenesisHash = hash(999)
	if _, err = store.Load(ctx, hash(550)); err == nil {
		t.Fatal("wrong genesis accepted")
	}
	store.GenesisHash = hash(500)
	exec(`UPDATE tickergarden.chain_journal SET updated_at=now()-interval '121 seconds' WHERE chain_id=421614`)
	if _, err = store.Load(ctx, hash(550)); err == nil {
		t.Fatal("stale journal accepted")
	}
	exec(`UPDATE tickergarden.chain_journal SET updated_at=now() WHERE chain_id=421614`)
	exec(`UPDATE tickergarden.chain_blocks SET parent_hash=$1 WHERE chain_id=421614 AND hash=$2`, hash(999), hash(503))
	if _, err = store.Load(ctx, hash(550)); err == nil {
		t.Fatal("broken ancestry accepted")
	}
	exec(`UPDATE tickergarden.chain_blocks SET parent_hash=$1 WHERE chain_id=421614 AND hash=$2`, hash(501), hash(503))
	exec(`UPDATE tickergarden.chain_receipts SET payload=jsonb_set(payload,'{status}','"0x1"') WHERE chain_id=421614 AND block_hash=$1`, hash(503))
	if _, err = store.Load(ctx, hash(550)); err == nil {
		t.Fatal("mutated receipt accepted")
	}
	exec(`UPDATE tickergarden.chain_receipts SET status='0x1' WHERE chain_id=421614 AND block_hash=$1`, hash(503))
	if _, err = store.Load(ctx, hash(550)); err == nil {
		t.Fatal("changed receipt set commitment accepted")
	}
}
