package maintenance

import (
	"context"
	"errors"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type reconcileGasFixture struct {
	*receiptRPCFixture
	missing bool
}

func (f *reconcileGasFixture) CodeAt(context.Context, string, string) ([]byte, error) {
	return nil, errors.New("unexpected code read")
}
func (f *reconcileGasFixture) CallAt(context.Context, string, string, string) ([]byte, error) {
	return nil, errors.New("unexpected call read")
}
func (f *reconcileGasFixture) TransactionGasReceipt(context.Context, string) (*chainrpc.GasReceipt, error) {
	if f.missing {
		return nil, errors.New("fee fields unavailable")
	}
	return &chainrpc.GasReceipt{Receipt: *f.receipt, GasUsed: "0x5208", EffectiveGasPrice: "0x2"}, nil
}
func exerciseGasReconciliation(t *testing.T, ctx context.Context, s Store, p deployment.MaintenancePreview, signed SignedTransaction) {
	t.Helper()
	before, e := s.GasBudget(ctx, p.GenesisHash, p.From)
	if e != nil {
		t.Fatal(e)
	}
	// Enroll current submissions and isolate this job from unrelated fixtures.
	c, e := s.claimDue(ctx)
	if e != nil || c.key == "" {
		t.Fatal(c, e)
	}
	if e = s.finishReconcile(ctx, c, ReconcileResult{Status: "not_observed"}); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_reconciliation_queue SET due_at=clock_timestamp()+interval '1 day',claim_until='-infinity'`); e != nil {
		t.Fatal(e)
	}
	due := func() {
		t.Helper()
		if _, e = s.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_reconciliation_queue SET due_at='-infinity' WHERE job_key=$1`, p.Key); e != nil {
			t.Fatal(e)
		}
	}
	f := &reconcileGasFixture{receiptRPCFixture: &receiptRPCFixture{p: p, finalized: true, receipt: &chainrpc.Receipt{TransactionHash: signed.TransactionHash, TransactionIndex: "0x0", BlockHash: p.BlockHash, BlockNumber: p.BlockNumber, Status: "0x0", Logs: []chainrpc.Log{}}}, missing: true}
	w := Reconciler{Store: s, RPC: f, Manifest: deployment.Manifest{ChainID: s.ChainID, GenesisHash: p.GenesisHash}}
	due()
	r, e := w.Step(ctx)
	if e != nil || r.Status != "finalized_reverted" || r.GasStatus != "unavailable" || r.GasSequence != 0 {
		t.Fatal("fee failure erased receipt outcome", r, e)
	}
	var status string
	var failures int
	var sequence *int64
	var early bool
	if e = s.Pool.QueryRow(ctx, `SELECT gas_status,gas_failures,gas_sequence,due_at>clock_timestamp() AND due_at<clock_timestamp()+interval '65 seconds' FROM tickergarden.maintenance_reconciliation_queue WHERE job_key=$1`, p.Key).Scan(&status, &failures, &sequence, &early); e != nil || status != "unavailable" || failures != 1 || sequence != nil || !early {
		t.Fatal(status, failures, sequence, early, e)
	}
	idle, e := w.Step(ctx)
	if e != nil || idle.Action != "idle" {
		t.Fatal("gas failure ignored delay", idle, e)
	}
	due()
	f.missing = false
	recorded, e := w.Step(ctx)
	if e != nil || recorded.GasStatus != "recorded" || recorded.GasSequence == 0 || recorded.Status != "finalized_reverted" {
		t.Fatal(recorded, e)
	}
	var source int64
	if e = s.Pool.QueryRow(ctx, `SELECT receipt_sequence FROM tickergarden.maintenance_gas_observations WHERE sequence=$1`, recorded.GasSequence).Scan(&source); e != nil || source != recorded.ReceiptSequence {
		t.Fatal("fee and receipt sources differ", source, e)
	}
	// A subsequent missing receipt clears the queue's current fee reference, while
	// preserving the historical fee evidence and the conservative budget charge.
	due()
	f.receipt = nil
	absent, e := w.Step(ctx)
	if e != nil || absent.Status != "not_observed" || absent.GasStatus != "not_finalized" || absent.GasSequence != 0 {
		t.Fatal(absent, e)
	}
	if e = s.Pool.QueryRow(ctx, `SELECT gas_sequence,gas_failures FROM tickergarden.maintenance_reconciliation_queue WHERE job_key=$1`, p.Key).Scan(&sequence, &failures); e != nil || sequence != nil || failures != 0 {
		t.Fatal("stale gas reference retained", sequence, failures, e)
	}
	after, e := s.GasBudget(ctx, p.GenesisHash, p.From)
	if e != nil || before != after {
		t.Fatal("reconciliation released budget", before, after, e)
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_reconciliation_queue SET due_at='-infinity',claim_until='-infinity'`); e != nil {
		t.Fatal(e)
	}
}
