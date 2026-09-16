package maintenance

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestIsolatedMaintenanceSigningWorker(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_SIGNER_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated signing database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 10)
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
	key := os.Getenv("TG_MAINTENANCE_PREPARED_TEST_KEY")
	var calls atomic.Int64
	w := SigningWorker{Store: Store{Pool: pool, ChainID: m.ChainID}, From: os.Getenv("TG_MAINTENANCE_FROM"), GenesisHash: m.GenesisHash, Signer: testSigner(func(context.Context, IntentRecord) ([]byte, error) {
		calls.Add(1)
		return nil, errors.New("test provider lost response")
	})}
	before, e := w.Store.Intent(ctx, key)
	if e != nil {
		t.Fatal(e)
	}
	// Expired authorization cannot create a signing request.
	var expiry time.Time
	if e = pool.QueryRow(ctx, `SELECT expires_at FROM tickergarden.maintenance_leases WHERE job_key=$1 ORDER BY generation DESC LIMIT 1`, key).Scan(&expiry); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	if _, e = w.sign(ctx, key); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("expired signing accepted", e)
	}
	var count int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_sign_requests WHERE job_key=$1`, key).Scan(&count); e != nil || count != 0 || calls.Load() != 0 {
		t.Fatal(count, e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=$2 WHERE job_key=$1`, key, expiry); e != nil {
		t.Fatal(e)
	}
	// Concurrent dispatcher calls persist one unknown request and never reinvoke it.
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := w.sign(ctx, key)
			if e != nil || r.Status != "signing_unknown" {
				t.Error(r, e)
			}
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatal("duplicate signer calls", calls.Load())
	}
	// Enroll all eligible jobs, then isolate this fixture's due time.
	c, e := w.claim(ctx)
	if e != nil || c.key == "" {
		t.Fatal(c, e)
	}
	if e = w.finish(ctx, c, SigningResult{Status: "unavailable"}); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_signing_queue SET due_at=clock_timestamp()+interval '1 hour',claim_until='-infinity'`); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_signing_queue SET due_at='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	wrong := w
	wrong.From = "0x1111111111111111111111111111111111111111"
	if c, e := wrong.claim(ctx); e != nil || c.key != "" {
		t.Fatal("sender isolation", c, e)
	}
	a, e := w.claim(ctx)
	if e != nil || a.key != key {
		t.Fatal(a, e)
	}
	if b, e := w.claim(ctx); e != nil || b.key != "" {
		t.Fatal("duplicate claim", b, e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_signing_queue SET claim_until='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	b, e := w.claim(ctx)
	if e != nil || b.key != key || b.generation != a.generation+1 {
		t.Fatal(b, e)
	}
	if e = w.finish(ctx, a, SigningResult{Status: "signed_stored"}); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("stale fence", e)
	}
	if e = w.finish(ctx, b, SigningResult{Status: "signing_unknown"}); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_signing_queue SET due_at='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	r, e := w.Step(ctx)
	if e != nil || r.Status != "signing_unknown" || calls.Load() != 1 {
		t.Fatal(r, e, calls.Load())
	}
	after, e := w.Store.Intent(ctx, key)
	if e != nil || before.Digest != after.Digest {
		t.Fatal("intent changed", e)
	}
	// Leave all eligible jobs due for the CLI recovery and signing smoke.
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_signing_queue SET due_at='-infinity'`); e != nil {
		t.Fatal(e)
	}
}

func TestIsolatedMaintenanceSigningWorkerRestart(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_SIGNER_RESTART_DSN")
	if dsn == "" {
		t.Skip("isolated signed database required")
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
	key := os.Getenv("TG_MAINTENANCE_PREPARED_TEST_KEY")
	w := SigningWorker{Store: Store{Pool: pool, ChainID: m.ChainID}, From: os.Getenv("TG_MAINTENANCE_FROM"), GenesisHash: m.GenesisHash, Signer: testSigner(func(context.Context, IntentRecord) ([]byte, error) {
		t.Error("restart called signer")
		return nil, errors.New("unexpected")
	})}
	before, e := w.Store.Signed(ctx, key)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_signing_queue SET status='queued',due_at='-infinity',claim_until='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	r, e := w.Step(ctx)
	if e != nil || r.Status != "signed_stored" || r.TransactionHash != before.TransactionHash {
		t.Fatal(r, e)
	}
	r, e = w.Step(ctx)
	if e != nil || r.Action != "idle" {
		t.Fatal(r, e)
	}
}
