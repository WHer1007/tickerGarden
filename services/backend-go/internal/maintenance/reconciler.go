package maintenance

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
)

type ReconciliationRPC interface {
	PoststateRPC
	GasCostRPC
}
type Reconciler struct {
	Store    Store
	RPC      ReconciliationRPC
	Manifest deployment.Manifest
}
type ReconcileResult struct {
	GasStatus         string `json:"gasStatus,omitempty"`
	GasSequence       int64  `json:"gasSequence,omitempty"`
	Action            string `json:"action"`
	JobKey            string `json:"jobKey,omitempty"`
	Status            string `json:"status,omitempty"`
	ReceiptSequence   int64  `json:"receiptSequence,omitempty"`
	PoststateSequence int64  `json:"poststateSequence,omitempty"`
}
type reconcileClaim struct {
	key         string
	generation  int64
	failures    int
	gasFailures int
}

// claimDue discovers bounded new submissions and claims one due task. Queue
// leases authorize observation only, never signing, nonce mutation or broadcast.
func (s Store) claimDue(ctx context.Context) (reconcileClaim, error) {
	if s.Pool == nil {
		return reconcileClaim{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_reconciliation_queue(job_key)
 SELECT s.job_key FROM tickergarden.maintenance_submissions s JOIN tickergarden.maintenance_jobs j USING(job_key)
 WHERE j.chain_id=$1 AND NOT EXISTS(SELECT 1 FROM tickergarden.maintenance_reconciliation_queue q WHERE q.job_key=s.job_key)
 ORDER BY s.created_at,s.job_key LIMIT 100 ON CONFLICT DO NOTHING`, s.ChainID)
	if e != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	var c reconcileClaim
	e = tx.QueryRow(ctx, `SELECT q.job_key,q.generation,q.failures,q.gas_failures FROM tickergarden.maintenance_reconciliation_queue q
 JOIN tickergarden.maintenance_jobs j USING(job_key)
 WHERE j.chain_id=$1 AND q.due_at<=clock_timestamp() AND q.claim_until<=clock_timestamp()
 ORDER BY q.due_at,q.job_key FOR UPDATE OF q SKIP LOCKED LIMIT 1`, s.ChainID).Scan(&c.key, &c.generation, &c.failures, &c.gasFailures)
	if errors.Is(e, pgx.ErrNoRows) {
		if tx.Commit(ctx) != nil {
			return reconcileClaim{}, ErrUnavailable
		}
		return c, nil
	}
	if e != nil || c.generation == 1<<63-1 {
		return reconcileClaim{}, ErrUnavailable
	}
	c.generation++
	_, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_reconciliation_queue SET generation=$2,claim_until=clock_timestamp()+interval '120 seconds' WHERE job_key=$1`, c.key, c.generation)
	if e != nil || tx.Commit(ctx) != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	return c, nil
}
func reconcileDelay(status string, failures int) time.Duration {
	if status == "unavailable" {
		if failures > 7 {
			failures = 7
		}
		seconds := 30 * (1 << failures)
		if seconds > 3600 {
			seconds = 3600
		}
		return time.Duration(seconds) * time.Second
	}
	if status == "verified_complete" || status == "finalized_reverted" {
		return time.Hour
	}
	return 30 * time.Second
}
func (s Store) finishReconcile(ctx context.Context, c reconcileClaim, r ReconcileResult) error {
	failures := 0
	if r.Status == "unavailable" {
		failures = c.failures + 1
		if failures > 16 {
			failures = 16
		}
	}
	delay := reconcileDelay(r.Status, failures)
	if r.GasStatus == "" {
		r.GasStatus = "not_checked"
	}
	gasFailures := 0
	if r.GasStatus == "unavailable" {
		gasFailures = min(c.gasFailures+1, 16)
		delay = min(delay, reconcileDelay("unavailable", gasFailures))
	}
	var gas any
	if r.GasSequence > 0 {
		gas = r.GasSequence
	}
	var receipt, post any
	if r.ReceiptSequence > 0 {
		receipt = r.ReceiptSequence
	}
	if r.PoststateSequence > 0 {
		post = r.PoststateSequence
	}
	tag, e := s.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_reconciliation_queue SET status=$3,failures=$4,receipt_sequence=$5,poststate_sequence=$6,
 checked_at=clock_timestamp(),due_at=clock_timestamp()+$7*interval '1 second',claim_until='-infinity',gas_status=$8,gas_sequence=$9,gas_failures=$10
 WHERE job_key=$1 AND generation=$2 AND claim_until>clock_timestamp()`, c.key, c.generation, r.Status, failures, receipt, post, int64(delay/time.Second), r.GasStatus, gas, gasFailures)
	if e != nil || tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

// Step processes one task. Transient per-job failures are durably scheduled for
// retry, so a broken task does not prevent other submitted jobs from progressing.
func (w Reconciler) Step(ctx context.Context) (ReconcileResult, error) {
	if w.RPC == nil || w.Manifest.ChainID != w.Store.ChainID {
		return ReconcileResult{}, ErrUnavailable
	}
	id, e := w.RPC.ChainID(ctx)
	if e != nil || id != w.Manifest.ChainID {
		return ReconcileResult{}, ErrUnavailable
	}
	genesis, e := w.RPC.Header(ctx, "0x0")
	if e != nil || genesis.Hash != w.Manifest.GenesisHash {
		return ReconcileResult{}, ErrUnavailable
	}
	c, e := w.Store.claimDue(ctx)
	if e != nil {
		return ReconcileResult{}, e
	}
	if c.key == "" {
		return ReconcileResult{Action: "idle"}, nil
	}
	result := ReconcileResult{Action: "checked", JobKey: c.key, Status: "unavailable", GasStatus: "not_checked"}
	receipt, e := w.Store.ObserveReceipt(ctx, w.RPC, c.key)
	if e == nil {
		result.ReceiptSequence = receipt.Sequence
		result.Status = receipt.Observation.Status
		result.GasStatus = "not_finalized"
		if receipt.Observation.Status == "finalized_success" || receipt.Observation.Status == "finalized_reverted" {
			result.GasStatus = "unavailable"
			gasCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
			gas, e := w.Store.observeGasFromReceipt(gasCtx, w.RPC, c.key, receipt)
			cancel()
			if e == nil {
				result.GasStatus = "recorded"
				result.GasSequence = gas.Sequence
			}
		}
		if receipt.Observation.Status == "finalized_success" {
			post, e := w.Store.verifyObservedPoststate(ctx, w.RPC, w.Manifest, c.key, receipt)
			if e != nil {
				result.Status = "unavailable"
			} else {
				result.PoststateSequence = post.Sequence
				result.Status = "poststate_unmet"
				if post.Evidence.State.Satisfied {
					result.Status = "verified_complete"
				}
			}
		}
	}
	if e = w.Store.finishReconcile(ctx, c, result); e != nil {
		return ReconcileResult{}, e
	}
	return result, nil
}
