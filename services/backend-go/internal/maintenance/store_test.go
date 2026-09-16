package maintenance

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
)

// Runs only against the isolated smoke database, never a normal operator DSN.
func TestIsolatedMaintenanceRecords(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated maintenance database not supplied")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 8)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	store := Store{Pool: pool, ChainID: 46630}
	key := os.Getenv("TG_MAINTENANCE_TEST_KEY")
	history, e := store.History(ctx, key, 0)
	if e != nil || len(history) != 1 {
		t.Fatal(history, e)
	}
	original := history[0]
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			r, e := store.Record(ctx, original.Preview)
			if e != nil || r.Sequence != original.Sequence {
				t.Errorf("concurrent duplicate: %v %v", r, e)
			}
		})
	}
	wg.Wait()
	history, e = store.History(ctx, key, 0)
	if e != nil || len(history) != 1 {
		t.Fatal("duplicate simulations", history, e)
	}
	next := original.Preview
	next.BlockNumber = "0x7fffff"
	next.BlockHash = "0x" + strings.Repeat("9", 64)
	r, e := store.Record(ctx, next)
	if e != nil || r.Sequence <= original.Sequence {
		t.Fatal(r, e)
	}
	history, e = store.History(ctx, key, original.Sequence)
	if e != nil || len(history) != 1 || history[0].Sequence != r.Sequence {
		t.Fatal("cursor", history, e)
	}
	// Structurally valid retargeting with the same intent must not create a job.
	other := original.Preview
	other.To = "0x" + strings.Repeat("8", 40)
	other.Key = deployment.Hash([]byte(strings.Join([]string{"V1-EXEC-11:maintenance-v1", "46630", other.GenesisHash, other.From, other.Module, other.To, other.Request.Operation, other.Request.MarketID, other.Request.User, other.Request.TriggerID}, ":")))
	if deployment.ValidateMaintenancePreview(other) != nil {
		t.Fatal("invalid conflict fixture")
	}
	if _, e = store.Record(ctx, other); e == nil {
		t.Fatal("retargeted trigger accepted")
	}
	badChain := Store{Pool: pool, ChainID: 4663}
	if _, e = badChain.History(ctx, key, 0); e == nil {
		t.Fatal("cross-chain history accepted")
	}
	raw, _ := json.Marshal(original.Preview)
	defer pool.Exec(context.Background(), `UPDATE tickergarden.maintenance_simulations SET payload=$1 WHERE sequence=$2`, raw, original.Sequence)
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_simulations SET payload=$1 WHERE sequence=$2`, []byte("{}"), original.Sequence); e != nil {
		t.Fatal(e)
	}
	if _, e = store.History(ctx, key, 0); e == nil {
		t.Fatal("corrupt history accepted")
	}
	if _, e = store.Record(ctx, original.Preview); e == nil {
		t.Fatal("corrupt duplicate overwritten")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_simulations SET payload=$1 WHERE sequence=$2`, raw, original.Sequence); e != nil {
		t.Fatal(e)
	}
	// Remove this test's artificial historical block; the CLI smoke records stay.
	if _, e = pool.Exec(ctx, `DELETE FROM tickergarden.maintenance_simulations WHERE sequence=$1`, r.Sequence); e != nil {
		t.Fatal(e)
	}
}
