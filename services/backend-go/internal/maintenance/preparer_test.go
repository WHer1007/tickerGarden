package maintenance

import (
	"context"
	"os"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestIsolatedMaintenancePreparer(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_PREPARER_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated preparer database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 4)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	raw, e := os.ReadFile(os.Getenv("TG_MAINTENANCE_TEST_MANIFEST"))
	if e != nil {
		t.Fatal(e)
	}
	m, e := deployment.Parse(raw)
	if e != nil {
		t.Fatal(e)
	}
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		t.Fatal(e)
	}
	w := Preparer{Store: Store{Pool: pool, ChainID: m.ChainID}, RPC: rpc, Manifest: m, From: os.Getenv("TG_MAINTENANCE_FROM"), Fees: Fees{"200000", "100000000000", "1000000000"}}
	key := os.Getenv("TG_MAINTENANCE_PREPARED_TEST_KEY")
	before, e := w.Store.Intent(ctx, key)
	if e != nil {
		t.Fatal(e)
	}
	var nonceBefore, nonceAfter string
	if e = pool.QueryRow(ctx, `SELECT next_nonce::text FROM tickergarden.maintenance_nonce_accounts WHERE chain_id=$1 AND sender=$2 AND genesis_hash=$3`, m.ChainID, w.From, m.GenesisHash).Scan(&nonceBefore); e != nil {
		t.Fatal(e)
	}
	// Model the crash window after the atomic preparation commit but before the
	// queue result commit. Recovery must read the old intent even after lease expiry.
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_preparation_queue SET status='queued',due_at='-infinity',claim_until='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	r, e := w.Step(ctx)
	if e != nil || r.Status != "intent_prepared" || r.IntentDigest != before.Digest {
		t.Fatal(r, e)
	}
	if e = pool.QueryRow(ctx, `SELECT next_nonce::text FROM tickergarden.maintenance_nonce_accounts WHERE chain_id=$1 AND sender=$2 AND genesis_hash=$3`, m.ChainID, w.From, m.GenesisHash).Scan(&nonceAfter); e != nil || nonceAfter != nonceBefore {
		t.Fatal("recovery allocated nonce", nonceBefore, nonceAfter, e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_preparation_queue SET status='queued',due_at='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	a, e := w.claim(ctx)
	if e != nil || a.key != key {
		t.Fatal(a, e)
	}
	if b, e := w.claim(ctx); e != nil || b.key != "" {
		t.Fatal("claimed active task", b, e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_preparation_queue SET claim_until='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	b, e := w.claim(ctx)
	if e != nil || b.key != key || b.generation != a.generation+1 {
		t.Fatal(b, e)
	}
	if e = w.finish(ctx, a, PrepareResult{Status: "intent_prepared"}); e != ErrLeaseLost {
		t.Fatal("old fence accepted", e)
	}
	if e = w.finish(ctx, b, PrepareResult{Status: "unavailable"}); e != nil {
		t.Fatal(e)
	}
	var failures int
	var delayed bool
	if e = pool.QueryRow(ctx, `SELECT failures,due_at>clock_timestamp() FROM tickergarden.maintenance_preparation_queue WHERE job_key=$1`, key).Scan(&failures, &delayed); e != nil || failures != 1 || !delayed {
		t.Fatal(failures, delayed, e)
	}
	// Restore the prepared result for subsequent signing smoke; the intent is unchanged.
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_preparation_queue SET status='intent_prepared' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}

}
