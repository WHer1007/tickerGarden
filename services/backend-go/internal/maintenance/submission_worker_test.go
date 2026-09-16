package maintenance

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

type dispatchTestRPC struct {
	t *testing.T
	DispatchRPC
	sends *atomic.Int64
	store Store
	key   string
}

func (r dispatchTestRPC) SendRawTransaction(ctx context.Context, raw []byte) (string, error) {
	r.sends.Add(1)
	hash := deployment.Hash(raw)
	old, e := r.store.Submission(ctx, r.key)
	if e != nil || old.TransactionHash != hash || old.Status != "submission_unknown" {
		r.t.Error("outbox was not committed before send", old, e)
		return "", errors.New("outbox was not committed")
	}
	return hash, chainrpc.ErrSubmissionUnknown
}
func TestIsolatedMaintenanceSubmissionWorker(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_SUBMITTER_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated signed database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 12)
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
	key := os.Getenv("TG_MAINTENANCE_PREPARED_TEST_KEY")
	var sends atomic.Int64
	store := Store{Pool: pool, ChainID: m.ChainID}
	w := SubmissionWorker{Store: store, From: os.Getenv("TG_MAINTENANCE_FROM"), Manifest: m, RPC: dispatchTestRPC{t, rpc, &sends, store, key}}
	// The preceding signing-restart fixture left this authorization expired.
	if _, e = w.submit(ctx, key); !errors.Is(e, ErrLeaseLost) || sends.Load() != 0 {
		t.Fatal("expired authorization sent", e, sends.Load())
	}
	var count int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_submissions WHERE job_key=$1`, key).Scan(&count); e != nil || count != 0 {
		t.Fatal(count, e)
	}
	// Restore only this isolated test fixture's lease to exercise first dispatch.
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()+interval '300 seconds' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, e := w.submit(ctx, key)
			if (e != nil && !errors.Is(e, chainrpc.ErrSubmissionUnknown)) || out.Status != "submission_unknown" {
				t.Error(out, e)
			}
		}()
	}
	wg.Wait()
	if sends.Load() != 1 {
		t.Fatal("duplicate send", sends.Load())
	}
	// A lost response and crash before queue completion must be recovered without RPC.
	w.RPC = dispatchTestRPC{t, nil, &sends, store, key}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	out, e := w.submit(ctx, key)
	if e != nil || out.Status != "submission_unknown" || sends.Load() != 1 {
		t.Fatal(out, e)
	}
	c, e := w.claim(ctx)
	if e != nil || c.key == "" {
		t.Fatal(c, e)
	}
	if e = w.finish(ctx, c, SubmissionResult{Status: "unavailable"}); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_submission_queue SET due_at=clock_timestamp()+interval '1 hour',claim_until='-infinity'`); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_submission_queue SET due_at='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	wrong := w
	wrong.From = "0x1111111111111111111111111111111111111111"
	if c, e := wrong.claim(ctx); e != nil || c.key != "" {
		t.Fatal("cross sender", c, e)
	}
	a, e := w.claim(ctx)
	if e != nil || a.key != key {
		t.Fatal(a, e)
	}
	if b, e := w.claim(ctx); e != nil || b.key != "" {
		t.Fatal("duplicate claim", b, e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_submission_queue SET claim_until='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	b, e := w.claim(ctx)
	if e != nil || b.key != key || b.generation != a.generation+1 {
		t.Fatal(b, e)
	}
	if e = w.finish(ctx, a, SubmissionResult{Status: "acknowledged"}); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("stale fence", e)
	}
	if e = w.finish(ctx, b, SubmissionResult{Status: "unavailable"}); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_submission_queue SET due_at='-infinity' WHERE job_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	result, e := w.Step(ctx)
	if e != nil || result.Status != "submission_unknown" || sends.Load() != 1 {
		t.Fatal(result, e)
	}
	result, e = w.Step(ctx)
	if e != nil || result.Action != "idle" {
		t.Fatal("unknown rescheduled", result, e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_submission_queue SET due_at='-infinity'`); e != nil {
		t.Fatal(e)
	}
}
