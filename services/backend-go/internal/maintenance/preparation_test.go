package maintenance

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestIsolatedMaintenanceAtomicPreparation(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 8)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	store := Store{Pool: pool, ChainID: 46630}
	h, e := store.History(ctx, os.Getenv("TG_MAINTENANCE_TEST_KEY"), 0)
	if e != nil || len(h) == 0 {
		t.Fatal(e)
	}
	p := noncePreview(h[0].Preview, 901)
	p.From = "0x" + strings.Repeat("6", 40)
	p.Key = deployment.Hash([]byte(strings.Join([]string{"V1-EXEC-11:maintenance-v1", "46630", p.GenesisHash, p.From, p.Module, p.To, p.Request.Operation, p.Request.MarketID, p.Request.User, p.Request.TriggerID}, ":")))
	fees := Fees{"50000", "100", "2"}
	call, _, e := intentCall(p, Reservation{Nonce: "4"}, fees)
	if e != nil {
		t.Fatal(e)
	}
	var calls atomic.Int64
	f := intentFixture{nonceFixture: nonceFixture{p: p, pending: 4}, calls: &calls, want: call, bad: true}
	token := fmt.Sprintf("0x%064x", 901)
	if _, e = store.Prepare(ctx, f, p, fees, "atomic-worker", token, 60); e == nil {
		t.Fatal("failed simulation accepted")
	}
	for _, table := range []string{"maintenance_jobs", "maintenance_leases", "maintenance_nonce_reservations", "maintenance_transaction_intents"} {
		var count int
		if e = pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden."+table+" WHERE job_key=$1", p.Key).Scan(&count); e != nil || count != 0 {
			t.Fatal("partial preparation", table, count, e)
		}
	}
	f.bad = false
	// nonceFixture's pending nonce is fixed; no rolled-back allocation may advance it.
	f.want.Nonce = "0x4"
	var wg sync.WaitGroup
	results := make(chan Preparation, 8)
	for range 8 {
		wg.Go(func() {
			r, e := store.Prepare(ctx, f, p, fees, "atomic-worker", token, 60)
			if e != nil {
				t.Error(e)
				return
			}
			results <- r
		})
	}
	wg.Wait()
	close(results)
	var digest string
	count := 0
	for r := range results {
		if digest != "" && digest != r.Record.Digest {
			t.Fatal("multiple intents")
		}
		digest = r.Record.Digest
		count++
		if r.Record.Intent.Reservation.Nonce != "4" {
			t.Fatal(r)
		}
	}
	if count != 8 || calls.Load() != 2 {
		t.Fatal(count, calls.Load())
	}
	if _, e = store.Prepare(ctx, f, p, Fees{"50001", "100", "2"}, "atomic-worker", token, 60); e == nil {
		t.Fatal("changed fee bounds accepted")
	}
	read, e := store.Intent(ctx, p.Key)
	if e != nil || read.Digest != digest {
		t.Fatal(read, e)
	}
}
