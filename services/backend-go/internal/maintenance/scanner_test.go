package maintenance

import (
	"context"
	"os"
	"sync"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestIsolatedMaintenanceScanner(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_SCAN_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated scan database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 8)
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
	w := Scanner{Store: Store{Pool: pool, ChainID: m.ChainID}, Manifest: m, From: os.Getenv("TG_MAINTENANCE_FROM")}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_scan_queue SET due_at='-infinity'`); e != nil {
		t.Fatal(e)
	}
	var expected int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_scan_queue q WHERE q.operation<>'settle-rage-quit' OR EXISTS(SELECT 1 FROM tickergarden.canonical_projection_rows p WHERE p.chain_id=q.chain_id AND p.table_name='gaugePositions' AND p.row_key=q.user_address||':'||q.market_id)`).Scan(&expected); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	claims := make(chan scanClaim, 8)
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, e := w.claim(ctx)
			if e != nil {
				errs <- e
			} else if c.market != "" {
				claims <- c
			}
		}()
	}
	wg.Wait()
	close(claims)
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
	seen := map[string]bool{}
	var first scanClaim
	for c := range claims {
		if seen[c.operation+c.user] {
			t.Fatal("duplicate claim", c)
		}
		seen[c.operation+c.user] = true
		first = c
	}
	if len(seen) != expected {
		t.Fatal("expected distinct queued scopes", seen)
	}
	c, e := w.claim(ctx)
	if e != nil || c.market != "" {
		t.Fatal("active claim reused", c, e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_scan_queue SET claim_until='-infinity' WHERE operation=$1 AND user_address=$2`, first.operation, first.user); e != nil {
		t.Fatal(e)
	}
	recovered, e := w.claim(ctx)
	if e != nil || recovered.operation != first.operation || recovered.user != first.user || recovered.generation != first.generation+1 {
		t.Fatal(recovered, e)
	}
	if e = w.finish(ctx, first, "not_needed"); e != ErrLeaseLost {
		t.Fatal("old generation accepted", e)
	}
	if e = w.finish(ctx, recovered, "unavailable"); e != nil {
		t.Fatal(e)
	}
	var failures int
	var scheduled, released bool
	if e = pool.QueryRow(ctx, `SELECT failures,due_at>clock_timestamp(),claim_until='-infinity'::timestamptz FROM tickergarden.maintenance_scan_queue WHERE operation=$1 AND user_address=$2`, first.operation, first.user).Scan(&failures, &scheduled, &released); e != nil || failures != recovered.failures+1 || !scheduled || !released {
		t.Fatal(failures, scheduled, e)
	}
	// Invalidated discovery cannot enroll or claim more work.
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=$1 AND hash=(SELECT tip_hash FROM tickergarden.discovery_checkpoints WHERE chain_id=$1)`, m.ChainID); e != nil {
		t.Fatal(e)
	}
	defer pool.Exec(context.Background(), `UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=$1 AND hash=(SELECT tip_hash FROM tickergarden.discovery_checkpoints WHERE chain_id=$1)`, m.ChainID)
	if _, e = w.claim(ctx); e == nil {
		t.Fatal("invalidated checkpoint accepted")
	}
}
