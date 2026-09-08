package maintenance

import (
	"context"
	"errors"
	"sync"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"time"
)

func TestReconcileDelayBoundaries(t *testing.T) {
	for _, tc := range []struct {
		status   string
		failures int
		want     time.Duration
	}{{"not_observed", 0, 30 * time.Second}, {"verified_complete", 0, time.Hour}, {"finalized_reverted", 0, time.Hour}, {"unavailable", 1, time.Minute}, {"unavailable", 16, time.Hour}} {
		if got := reconcileDelay(tc.status, tc.failures); got != tc.want {
			t.Fatalf("%#v: %v", tc, got)
		}
	}
}
func exerciseReconciliationQueue(t *testing.T, ctx context.Context, store Store) {
	t.Helper()
	// Other isolated suites may contribute submissions to the same database.
	// Require every persisted fixture, rather than an order-dependent fixed count.
	rows, e := store.Pool.Query(ctx, `SELECT s.job_key FROM tickergarden.maintenance_submissions s JOIN tickergarden.maintenance_jobs j USING(job_key) WHERE j.chain_id=$1`, store.ChainID)
	if e != nil {
		t.Fatal(e)
	}
	expected := map[string]bool{}
	for rows.Next() {
		var key string
		if e = rows.Scan(&key); e != nil {
			t.Fatal(e)
		}
		expected[key] = true
	}
	rows.Close()
	if e = rows.Err(); e != nil || len(expected) < 4 || len(expected) > 100 {
		t.Fatal("invalid submission fixtures", len(expected), e)
	}
	results := make(chan reconcileClaim, len(expected)+2)
	var wg sync.WaitGroup
	for range len(expected) + 2 {
		wg.Go(func() {
			c, e := store.claimDue(ctx)
			if e != nil {
				t.Error(e)
				return
			}
			results <- c
		})
	}
	wg.Wait()
	close(results)
	seen := map[string]bool{}
	claims := []reconcileClaim{}
	for c := range results {
		if c.key == "" {
			continue
		}
		if !expected[c.key] {
			t.Fatal("unexpected claim", c.key)
		}
		if seen[c.key] {
			t.Fatal("duplicate claim")
		}
		seen[c.key] = true
		claims = append(claims, c)
	}
	if len(claims) != len(expected) {
		t.Fatalf("claims=%d, expected %d submitted fixtures", len(claims), len(expected))
	}
	c, e := store.claimDue(ctx)
	if e != nil || c.key != "" {
		t.Fatal("claimed an active task", c, e)
	}
	old := claims[0]
	if _, e = store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_reconciliation_queue SET claim_until=clock_timestamp()-interval '1 second' WHERE job_key=$1`, old.key); e != nil {
		t.Fatal(e)
	}
	replacement, e := store.claimDue(ctx)
	if e != nil || replacement.key != old.key || replacement.generation != old.generation+1 {
		t.Fatal("expired claim not recovered", replacement, e)
	}
	if e = store.finishReconcile(ctx, old, ReconcileResult{Status: "not_observed"}); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("old fence accepted", e)
	}
	if e = store.finishReconcile(ctx, replacement, ReconcileResult{Status: "not_observed"}); e != nil {
		t.Fatal(e)
	}
	for _, other := range claims[1:] {
		if e = store.finishReconcile(ctx, other, ReconcileResult{Status: "unavailable"}); e != nil {
			t.Fatal(e)
		}
	}
	var failures int
	if e = store.Pool.QueryRow(ctx, `SELECT failures FROM tickergarden.maintenance_reconciliation_queue WHERE job_key=$1`, claims[1].key).Scan(&failures); e != nil || failures != 1 {
		t.Fatal("failure backoff missing", failures, e)
	}
	c, e = store.claimDue(ctx)
	if e != nil || c.key != "" {
		t.Fatal("due time ignored", c, e)
	}

	history, e := store.History(ctx, old.key, 0)
	if e != nil || len(history) == 0 {
		t.Fatal(e)
	}
	f := &failedReconcileRPC{receiptRPCFixture: receiptRPCFixture{p: history[0].Preview}}
	if _, e = store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_reconciliation_queue SET due_at=clock_timestamp() WHERE job_key=$1`, old.key); e != nil {
		t.Fatal(e)
	}
	worker := Reconciler{Store: store, RPC: f, Manifest: deployment.Manifest{ChainID: store.ChainID, GenesisHash: history[0].Preview.GenesisHash}}
	outcome, e := worker.Step(ctx)
	if e != nil || outcome.Status != "unavailable" || outcome.JobKey != old.key {
		t.Fatal("RPC failure did not schedule retry", outcome, e)
	}
	if e = store.Pool.QueryRow(ctx, `SELECT failures FROM tickergarden.maintenance_reconciliation_queue WHERE job_key=$1`, old.key).Scan(&failures); e != nil || failures != 1 {
		t.Fatal("failed task not persisted", e)
	}
	// The real CLI smoke that follows exercises another submitted job. Keep these
	// synthetic RPC-only cases out of that independent live-Anvil scenario.
	if _, e = store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_reconciliation_queue SET due_at=clock_timestamp()+interval '1 day'`); e != nil {
		t.Fatal(e)
	}
}

type failedReconcileRPC struct{ receiptRPCFixture }

func (f *failedReconcileRPC) CodeAt(context.Context, string, string) ([]byte, error) {
	return nil, errors.New("unexpected code query")
}
func (f *failedReconcileRPC) CallAt(context.Context, string, string, string) ([]byte, error) {
	return nil, errors.New("unexpected call query")
}
func (f *failedReconcileRPC) TransactionReceipt(context.Context, string) (*chainrpc.Receipt, error) {
	return nil, errors.New("provider unavailable")
}

func (f *failedReconcileRPC) TransactionGasReceipt(context.Context, string) (*chainrpc.GasReceipt, error) {
	return nil, errors.New("provider unavailable")
}
