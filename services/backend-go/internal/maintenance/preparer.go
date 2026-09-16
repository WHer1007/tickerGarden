package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"strconv"
	"tickergarden/backend/internal/deployment"
	"time"
)

type PreparationRPC interface {
	DiscoveryRPC
	IntentObserver
}
type Preparer struct {
	Store    Store
	RPC      PreparationRPC
	Manifest deployment.Manifest
	From     string
	Fees     Fees
}
type PrepareResult struct {
	Action       string `json:"action"`
	JobKey       string `json:"jobKey,omitempty"`
	Status       string `json:"status,omitempty"`
	IntentDigest string `json:"intentDigest,omitempty"`
}

func (w Preparer) claim(ctx context.Context) (reconcileClaim, error) {
	tx, e := w.Store.Pool.Begin(ctx)
	if e != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	// Only active work discovered by the scanner is enrolled. A stored scope is
	// only a candidate source; fresh authenticated poststate and simulation follow.
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_preparation_queue(job_key)
 SELECT j.job_key FROM tickergarden.maintenance_jobs j
 WHERE j.chain_id=$1 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'from'=$2
 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'genesisHash'=$3
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_work_scopes s WHERE s.active_job_key=j.job_key)
 AND NOT EXISTS(SELECT 1 FROM tickergarden.maintenance_preparation_queue q WHERE q.job_key=j.job_key)
 ORDER BY j.created_at,j.job_key LIMIT 100 ON CONFLICT DO NOTHING`, w.Store.ChainID, w.From, w.Manifest.GenesisHash)
	if e != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	var c reconcileClaim
	e = tx.QueryRow(ctx, `SELECT q.job_key,q.generation,q.failures FROM tickergarden.maintenance_preparation_queue q JOIN tickergarden.maintenance_jobs j USING(job_key)
 WHERE j.chain_id=$1 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'from'=$2
 AND convert_from(j.identity_payload,'UTF8')::jsonb->>'genesisHash'=$3
 AND q.status<>'intent_prepared' AND q.due_at<=clock_timestamp() AND q.claim_until<=clock_timestamp()
 AND EXISTS(SELECT 1 FROM tickergarden.maintenance_work_scopes s WHERE s.active_job_key=j.job_key)
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
	_, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_preparation_queue SET generation=$2,claim_until=clock_timestamp()+interval '120 seconds' WHERE job_key=$1`, c.key, c.generation)
	if e != nil || tx.Commit(ctx) != nil {
		return reconcileClaim{}, ErrUnavailable
	}
	return c, nil
}
func (w Preparer) finish(ctx context.Context, c reconcileClaim, r PrepareResult) error {
	failures := 0
	delay := int64(60)
	if r.Status == "unavailable" {
		failures = c.failures + 1
		if failures > 16 {
			failures = 16
		}
		delay = int64(reconcileDelay(r.Status, failures).Seconds())
	}
	tag, e := w.Store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_preparation_queue SET status=$3,failures=$4,checked_at=clock_timestamp(),
 due_at=clock_timestamp()+$5*interval '1 second',claim_until='-infinity' WHERE job_key=$1 AND generation=$2 AND claim_until>clock_timestamp()`, c.key, c.generation, r.Status, failures, delay)
	if e != nil || tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}
func (w Preparer) prepare(ctx context.Context, key string, generation int64) (PrepareResult, error) {
	r := PrepareResult{Action: "checked", JobKey: key, Status: "unavailable"}
	tx, e := w.Store.Pool.Begin(ctx)
	if e != nil {
		return r, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = w.Store.lockLeaseJob(ctx, tx, key); e != nil {
		return r, e
	}
	var raw []byte
	var id identity
	if e = tx.QueryRow(ctx, `SELECT identity_payload FROM tickergarden.maintenance_jobs WHERE job_key=$1`, key).Scan(&raw); e != nil || json.Unmarshal(raw, &id) != nil || id.From != w.From || id.GenesisHash != w.Manifest.GenesisHash {
		return r, ErrUnavailable
	}
	var exists bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.maintenance_transaction_intents WHERE job_key=$1)`, key).Scan(&exists); e != nil {
		return r, ErrUnavailable
	}
	if e = tx.Rollback(ctx); e != nil {
		return r, ErrUnavailable
	}
	if exists {
		in, e := w.Store.Intent(ctx, key)
		if e != nil {
			return r, e
		}
		r.Status = "intent_prepared"
		r.IntentDigest = in.Digest
		return r, nil
	}
	block, e := w.RPC.Header(ctx, "latest")
	if e != nil {
		return r, e
	}
	state, e := deployment.ObserveMaintenancePoststate(ctx, w.RPC, w.Manifest, block, id.Request, id.Target)
	if e != nil {
		return r, e
	}
	var now time.Time
	timestamp, te := block.Time()
	if e = w.Store.Pool.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); e != nil || te != nil || timestamp > uint64(now.Unix()+5) || now.Unix()-int64(timestamp) > 120 {
		return r, ErrUnavailable
	}
	if state.Satisfied {
		r.Status = "not_needed"
		return r, nil
	}
	p, e := deployment.PreviewMaintenance(ctx, w.RPC, w.Manifest, block, w.From, id.Request)
	if e != nil || p.Key != key {
		return r, ErrUnavailable
	}
	// The preparation transaction itself is atomic. If a process dies after it
	// commits, the next claim reads the existing intent without another nonce.
	token := deployment.Hash([]byte(key + ":" + strconv.FormatInt(generation, 10)))
	in, e := w.Store.Prepare(ctx, w.RPC, p, w.Fees, "maintenance-preparer", token, 300)
	if e != nil {
		return r, e
	}
	r.Status = "intent_prepared"
	r.IntentDigest = in.Record.Digest
	return r, nil
}
func (w Preparer) Step(ctx context.Context) (PrepareResult, error) {
	if w.Store.Pool == nil || w.RPC == nil || w.Manifest.ChainID != w.Store.ChainID || !discoveryAddress.MatchString(w.From) || w.From == "0x0000000000000000000000000000000000000000" {
		return PrepareResult{}, ErrUnavailable
	}
	if _, _, e := intentCall(deployment.MaintenancePreview{}, Reservation{Nonce: "0"}, w.Fees); e != nil {
		return PrepareResult{}, e
	}
	id, e := w.RPC.ChainID(ctx)
	if e != nil || id != w.Store.ChainID {
		return PrepareResult{}, ErrUnavailable
	}
	g, e := w.RPC.Header(ctx, "0x0")
	if e != nil || g.Hash != w.Manifest.GenesisHash {
		return PrepareResult{}, ErrUnavailable
	}
	c, e := w.claim(ctx)
	if e != nil {
		return PrepareResult{}, e
	}
	if c.key == "" {
		return PrepareResult{Action: "idle"}, nil
	}
	r, e := w.prepare(ctx, c.key, c.generation)
	if e != nil {
		r = PrepareResult{Action: "checked", JobKey: c.key, Status: "unavailable"}
	}
	if e = w.finish(ctx, c, r); e != nil {
		return PrepareResult{}, e
	}
	return r, nil
}
