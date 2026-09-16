package maintenance

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

type SigningWorker struct {
	Store             Store
	Signer            Signer
	From, GenesisHash string
}
type SigningResult struct {
	Action          string `json:"action"`
	JobKey          string `json:"jobKey,omitempty"`
	Status          string `json:"status,omitempty"`
	TransactionHash string `json:"transactionHash,omitempty"`
}

func (w SigningWorker) claim(ctx context.Context) (reconcileClaim, error) {
	tx, e := w.Store.Pool.Begin(ctx)
	if e != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	// Only active, prepared work is enrolled. Sign validates the stored intent
	// and original authorization before requesting its fixed signature.
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_signing_queue(job_key)
 SELECT j.job_key FROM tickergarden.maintenance_jobs j
 WHERE j.chain_id=$1 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'from'=$2
 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'genesisHash'=$3
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_work_scopes s WHERE s.active_job_key=j.job_key)
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_preparation_queue p WHERE p.job_key=j.job_key AND p.status='intent_prepared')
 AND NOT EXISTS(SELECT 1 FROM tickergarden.maintenance_signing_queue q WHERE q.job_key=j.job_key)
 ORDER BY j.created_at,j.job_key LIMIT 100 ON CONFLICT DO NOTHING`, w.Store.ChainID, w.From, w.GenesisHash)
	if e != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	var c reconcileClaim
	e = tx.QueryRow(ctx, `SELECT q.job_key,q.generation,q.failures FROM tickergarden.maintenance_signing_queue q JOIN tickergarden.maintenance_jobs j USING(job_key)
 WHERE j.chain_id=$1 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'from'=$2
 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'genesisHash'=$3
 AND q.status<>'signed_stored' AND q.due_at<=clock_timestamp() AND q.claim_until<=clock_timestamp()
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_work_scopes s WHERE s.active_job_key=j.job_key)
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_preparation_queue p WHERE p.job_key=j.job_key AND p.status='intent_prepared')
 ORDER BY q.due_at,q.job_key FOR UPDATE OF q SKIP LOCKED LIMIT 1`, w.Store.ChainID, w.From, w.GenesisHash).Scan(&c.key, &c.generation, &c.failures)
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
	_, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_signing_queue SET generation=$2,claim_until=clock_timestamp()+interval '120 seconds' WHERE job_key=$1`, c.key, c.generation)
	if e != nil || tx.Commit(ctx) != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	return c, nil
}
func (w SigningWorker) finish(ctx context.Context, c reconcileClaim, r SigningResult) error {
	failures := 0
	delay := int64(60)
	if r.Status == "unavailable" {
		failures = c.failures + 1
		if failures > 16 {
			failures = 16
		}
		delay = int64(reconcileDelay(r.Status, failures).Seconds())
	}
	tag, e := w.Store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_signing_queue SET status=$3,failures=$4,checked_at=clock_timestamp(),
 due_at=clock_timestamp()+$5*interval '1 second',claim_until='-infinity' WHERE job_key=$1 AND generation=$2 AND claim_until>clock_timestamp()`, c.key, c.generation, r.Status, failures, delay)
	if e != nil || tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func (w SigningWorker) sign(ctx context.Context, key string) (SignResult, error) {
	tx, e := w.Store.Pool.Begin(ctx)
	if e != nil {
		return SignResult{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = w.Store.lockLeaseJob(ctx, tx, key); e != nil {
		return SignResult{}, e
	}
	var raw []byte
	var id identity
	if e = tx.QueryRow(ctx, `SELECT identity_payload FROM tickergarden.maintenance_jobs WHERE job_key=$1`, key).Scan(&raw); e != nil || json.Unmarshal(raw, &id) != nil || id.From != w.From || id.GenesisHash != w.GenesisHash {
		return SignResult{}, ErrUnavailable
	}
	r, e := reservationIn(ctx, tx, key)
	if e != nil || validateReservation(ctx, tx, r) != nil {
		return SignResult{}, ErrUnavailable
	}
	in, e := intentIn(ctx, tx, key)
	if e != nil || validateIntent(ctx, tx, r, in) != nil {
		return SignResult{}, ErrUnavailable
	}
	l, e := latestLease(ctx, tx, key)
	if e != nil || l.Owner != "maintenance-preparer" {
		return SignResult{}, ErrUnavailable
	}
	if e = tx.Rollback(ctx); e != nil {
		return SignResult{}, ErrUnavailable
	}
	return w.Store.Sign(ctx, w.Signer, key, in.Digest, l.Owner, l.Token, l.Generation)
}
func (w SigningWorker) Step(ctx context.Context) (SigningResult, error) {
	if w.Store.Pool == nil || w.Signer == nil || !discoveryAddress.MatchString(w.From) || w.From == "0x0000000000000000000000000000000000000000" || !leaseHash.MatchString(w.GenesisHash) {
		return SigningResult{}, ErrUnavailable
	}
	c, e := w.claim(ctx)
	if e != nil {
		return SigningResult{}, e
	}
	if c.key == "" {
		return SigningResult{Action: "idle"}, nil
	}
	r := SigningResult{Action: "checked", JobKey: c.key, Status: "unavailable"}
	signed, e := w.sign(ctx, c.key)
	if e == nil {
		r.Status = signed.Status
		if signed.Transaction != nil {
			r.TransactionHash = signed.Transaction.TransactionHash
		}
	} else if errors.Is(e, ErrLeaseLost) {
		r.Status = "authorization_required"
	}
	if e = w.finish(ctx, c, r); e != nil {
		return SigningResult{}, e
	}
	return r, nil
}
