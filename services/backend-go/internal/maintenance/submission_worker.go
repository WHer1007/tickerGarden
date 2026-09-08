package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"

	"github.com/jackc/pgx/v5"
)

type DispatchRPC interface {
	SubmissionRPC
	deployment.MaintenanceObserver
}
type SubmissionWorker struct {
	Store    Store
	RPC      DispatchRPC
	Manifest deployment.Manifest
	From     string
}
type SubmissionResult struct {
	Action          string `json:"action"`
	JobKey          string `json:"jobKey,omitempty"`
	Status          string `json:"status,omitempty"`
	TransactionHash string `json:"transactionHash,omitempty"`
}

func (w SubmissionWorker) claim(ctx context.Context) (reconcileClaim, error) {
	tx, e := w.Store.Pool.Begin(ctx)
	if e != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	// Only active work with a persisted signed result is enrolled.
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_submission_queue(job_key)
 SELECT j.job_key FROM tickergarden.maintenance_jobs j
 WHERE j.chain_id=$1 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'from'=$2
 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'genesisHash'=$3
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_work_scopes s WHERE s.active_job_key=j.job_key)
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_signing_queue p WHERE p.job_key=j.job_key AND p.status='signed_stored')
 AND NOT EXISTS(SELECT 1 FROM tickergarden.maintenance_submission_queue q WHERE q.job_key=j.job_key)
 ORDER BY j.created_at,j.job_key LIMIT 100 ON CONFLICT DO NOTHING`, w.Store.ChainID, w.From, w.Manifest.GenesisHash)
	if e != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	var c reconcileClaim
	e = tx.QueryRow(ctx, `SELECT q.job_key,q.generation,q.failures FROM tickergarden.maintenance_submission_queue q JOIN tickergarden.maintenance_jobs j USING(job_key)
 WHERE j.chain_id=$1 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'from'=$2
 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'genesisHash'=$3
 AND q.status NOT IN ('acknowledged','submission_unknown') AND q.due_at<=clock_timestamp() AND q.claim_until<=clock_timestamp()
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_work_scopes s WHERE s.active_job_key=j.job_key)
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_signing_queue p WHERE p.job_key=j.job_key AND p.status='signed_stored')
 ORDER BY q.due_at,q.job_key FOR UPDATE OF q SKIP LOCKED LIMIT 1`, w.Store.ChainID, w.From, w.Manifest.GenesisHash).Scan(&c.key, &c.generation, &c.failures)
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
	_, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_submission_queue SET generation=$2,claim_until=clock_timestamp()+interval '120 seconds' WHERE job_key=$1`, c.key, c.generation)
	if e != nil || tx.Commit(ctx) != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	return c, nil
}
func (w SubmissionWorker) finish(ctx context.Context, c reconcileClaim, r SubmissionResult) error {
	failures := 0
	delay := int64(60)
	if r.Status == "unavailable" {
		failures = c.failures + 1
		if failures > 16 {
			failures = 16
		}
		delay = int64(reconcileDelay(r.Status, failures).Seconds())
	}
	tag, e := w.Store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_submission_queue SET status=$3,failures=$4,checked_at=clock_timestamp(),
 due_at=clock_timestamp()+$5*interval '1 second',claim_until='-infinity' WHERE job_key=$1 AND generation=$2 AND claim_until>clock_timestamp()`, c.key, c.generation, r.Status, failures, delay)
	if e != nil || tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

// A committed submission is recovered before contacting RPC. Never turn an
// unknown network outcome into another automatic send.
func (w SubmissionWorker) submit(ctx context.Context, key string) (Submission, error) {
	tx, e := w.Store.Pool.Begin(ctx)
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	_, signed, e := w.Store.submissionMaterial(ctx, tx, key)
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	var raw []byte
	var id identity
	if e = tx.QueryRow(ctx, `SELECT identity_payload FROM tickergarden.maintenance_jobs WHERE job_key=$1`, key).Scan(&raw); e != nil || json.Unmarshal(raw, &id) != nil || id.From != w.From || id.GenesisHash != w.Manifest.GenesisHash {
		return Submission{}, ErrUnavailable
	}
	l, e := latestLease(ctx, tx, key)
	if e != nil || l.Owner != "maintenance-preparer" {
		return Submission{}, ErrUnavailable
	}
	old, e := submissionIn(ctx, tx, signed)
	if e == nil {
		if tx.Commit(ctx) != nil {
			return Submission{}, ErrUnavailable
		}
		return old, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Submission{}, ErrUnavailable
	}
	now, e := leaseNow(ctx, tx)
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	if l.Released || !l.ExpiresAt.After(now) {
		return Submission{}, ErrLeaseLost
	}
	if e = tx.Rollback(ctx); e != nil {
		return Submission{}, ErrUnavailable
	}
	block, e := w.RPC.Header(ctx, "latest")
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	p, e := deployment.PreviewMaintenance(ctx, w.RPC, w.Manifest, block, w.From, id.Request)
	if e != nil || p.Key != key {
		return Submission{}, ErrUnavailable
	}
	if _, e = w.Store.Record(ctx, p); e != nil {
		return Submission{}, e
	}
	return w.Store.Submit(ctx, w.RPC, p, signed.TransactionHash, l.Owner, l.Token, l.Generation)
}
func (w SubmissionWorker) Step(ctx context.Context) (SubmissionResult, error) {
	if w.Store.Pool == nil || w.RPC == nil || w.Store.ChainID != w.Manifest.ChainID || !discoveryAddress.MatchString(w.From) || w.From == "0x0000000000000000000000000000000000000000" || !leaseHash.MatchString(w.Manifest.GenesisHash) {
		return SubmissionResult{}, ErrUnavailable
	}
	c, e := w.claim(ctx)
	if e != nil {
		return SubmissionResult{}, e
	}
	if c.key == "" {
		return SubmissionResult{Action: "idle"}, nil
	}
	r := SubmissionResult{Action: "checked", JobKey: c.key, Status: "unavailable"}
	out, e := w.submit(ctx, c.key)
	if e == nil || errors.Is(e, chainrpc.ErrSubmissionUnknown) {
		r.Status = out.Status
		r.TransactionHash = out.TransactionHash
	} else if errors.Is(e, ErrBudgetRequired) {
		r.Status = "budget_required"
	} else if errors.Is(e, ErrBudgetExceeded) {
		r.Status = "budget_exceeded"
	} else if errors.Is(e, ErrLeaseLost) {
		r.Status = "authorization_required"
	}
	if e = w.finish(ctx, c, r); e != nil {
		return SubmissionResult{}, e
	}
	return r, nil
}
