package maintenance

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/postgres"
)

type intentFixture struct {
	nonceFixture
	bad   bool
	calls *atomic.Int64
	want  chainrpc.IntentCall
}

func (f intentFixture) SimulateIntentAt(_ context.Context, call chainrpc.IntentCall, hash string) ([]byte, error) {
	f.calls.Add(1)
	if f.bad || call != f.want || hash != f.p.BlockHash {
		return nil, errors.New("private RPC response")
	}
	return hex.DecodeString(strings.Repeat("0", 63) + "7" + strings.Repeat("0", 63) + "9" + strings.Repeat("0", 63) + "1")
}
func TestIsolatedMaintenanceTransactionIntents(t *testing.T) {
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
	history, e := store.History(ctx, os.Getenv("TG_MAINTENANCE_TEST_KEY"), 0)
	if e != nil || len(history) == 0 {
		t.Fatal(e)
	}
	p := noncePreview(history[0].Preview, 100)
	if p.Request.Operation != "settle-rage-quit" {
		t.Fatal("unexpected fixture")
	}
	if _, e = store.Record(ctx, p); e != nil {
		t.Fatal(e)
	}
	l, e := store.AcquireLease(ctx, p.Key, "intent-worker", fmt.Sprintf("0x%064x", 6000), 60)
	if e != nil {
		t.Fatal(e)
	}
	r, e := store.ReserveNonce(ctx, nonceFixture{p: p}, p, l.Owner, l.Token, l.Generation)
	if e != nil {
		t.Fatal(e)
	}
	fees := Fees{"50000", "100", "2"}
	call, _, e := intentCall(p, r, fees)
	if e != nil {
		t.Fatal(e)
	}
	var calls atomic.Int64
	f := intentFixture{nonceFixture: nonceFixture{p: p}, calls: &calls, want: call, bad: true}
	if _, e = store.PrepareIntent(ctx, f, p, fees, l.Owner, l.Token, l.Generation); e == nil || strings.Contains(e.Error(), "private") {
		t.Fatal("failed simulation", e)
	}
	if _, e = store.Intent(ctx, p.Key); e == nil {
		t.Fatal("failed simulation persisted intent")
	}
	f.bad = false
	var wg sync.WaitGroup
	results := make(chan IntentRecord, 8)
	for range 8 {
		wg.Go(func() {
			r, e := store.PrepareIntent(ctx, f, p, fees, l.Owner, l.Token, l.Generation)
			if e != nil {
				t.Error(e)
				return
			}
			results <- r
		})
	}
	wg.Wait()
	close(results)
	var saved IntentRecord
	count := 0
	for r := range results {
		if count > 0 && r.Digest != saved.Digest {
			t.Fatal("multiple intents")
		}
		saved = r
		count++
	}
	if count != 8 || calls.Load() != 2 || saved.Intent.MaximumGasCost != "5000000" || saved.Intent.Status != "intent_prepared" {
		t.Fatal(count, calls.Load(), saved)
	}
	if _, e = store.PrepareIntent(ctx, f, p, Fees{"50001", "100", "2"}, l.Owner, l.Token, l.Generation); e == nil {
		t.Fatal("gas override accepted")
	}
	if _, e = store.PrepareIntent(ctx, f, p, fees, l.Owner, l.Token, l.Generation+1); e == nil {
		t.Fatal("wrong fence accepted")
	}
	read, e := store.Intent(ctx, p.Key)
	if e != nil || read.Digest != saved.Digest {
		t.Fatal(read, e)
	}
	raw, _ := json.Marshal(saved.Intent)
	defer pool.Exec(context.Background(), `UPDATE tickergarden.maintenance_transaction_intents SET payload=$1 WHERE job_key=$2`, raw, p.Key)
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_transaction_intents SET payload=$1 WHERE job_key=$2`, []byte("{}"), p.Key); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Intent(ctx, p.Key); e == nil {
		t.Fatal("corrupt intent accepted")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_transaction_intents SET payload=$1 WHERE job_key=$2`, raw, p.Key); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, p.Key); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Intent(ctx, p.Key); e != nil {
		t.Fatal("historical intent lost", e)
	}
	if _, e = store.PrepareIntent(ctx, f, p, fees, l.Owner, l.Token, l.Generation); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("expired prepare accepted", e)
	}
}
