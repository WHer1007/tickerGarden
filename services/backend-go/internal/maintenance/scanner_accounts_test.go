package maintenance

import (
	"context"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestIsolatedMaintenanceScannerAccounts(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_SCAN_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated scan database required")
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
	w := Scanner{Store: Store{Pool: pool, ChainID: m.ChainID}, Manifest: m, RPC: rpc, From: os.Getenv("TG_MAINTENANCE_FROM")}
	var market, hash string
	if e = pool.QueryRow(ctx, `SELECT market_id,block_hash FROM tickergarden.canonical_discovered_markets LIMIT 1`).Scan(&market, &hash); e != nil {
		t.Fatal(e)
	}
	users := []string{"0x" + strings.Repeat("9a", 20), "0x" + strings.Repeat("9b", 20)}
	// Synthetic candidate rows do not assert a payable balance. Live contract
	// reads must still return not_needed for both, independent of payload claims.
	for _, u := range users {
		key := u + ":" + market
		if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES($1,'gaugePositions',$2,'{"values":{"rageQuitSettlementPending":true}}',$3)`, m.ChainID, key, hash); e != nil {
			t.Fatal(e)
		}
		defer pool.Exec(context.Background(), `DELETE FROM tickergarden.projection_rows WHERE chain_id=$1 AND table_name='gaugePositions' AND row_key=$2`, m.ChainID, key)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_scan_queue SET due_at=clock_timestamp()+interval '1 day',claim_until='-infinity'`); e != nil {
		t.Fatal(e)
	}
	var before, after int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_jobs`).Scan(&before); e != nil {
		t.Fatal(e)
	}
	seen := map[string]bool{}
	for range users {
		r, e := w.Step(ctx)
		if e != nil || r.Status != "not_needed" || r.Operation != "settle-rage-quit" || r.Discovery == nil {
			t.Fatal(r, e)
		}
		if r.User != users[0] && r.User != users[1] {
			t.Fatal("unexpected account", r)
		}
		if seen[r.User] {
			t.Fatal("duplicate account", r)
		}
		seen[r.User] = true
	}
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_jobs`).Scan(&after); e != nil || after != before {
		t.Fatal("projected pending flag created job without live need", before, after, e)
	}
	if r, e := w.Step(ctx); e != nil || r.Action != "idle" {
		t.Fatal("restart state not idle", r, e)
	}
	// Canonical source loss prevents a queued account from being claimed.
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_scan_queue SET due_at='-infinity' WHERE user_address=$1`, users[0]); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `DELETE FROM tickergarden.projection_rows WHERE chain_id=$1 AND table_name='gaugePositions' AND row_key=$2`, m.ChainID, users[0]+":"+market); e != nil {
		t.Fatal(e)
	}
	if r, e := w.Step(ctx); e != nil || r.Action != "idle" {
		t.Fatal("orphan account claimed", r, e)
	}
}
