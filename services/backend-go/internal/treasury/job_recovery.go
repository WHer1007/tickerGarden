package treasury

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
)

type JobAudit struct {
	Sequence      int64     `json:"sequence"`
	Event         string    `json:"event"`
	PreviousState *string   `json:"previousState"`
	State         string    `json:"state"`
	Attempts      int       `json:"attempts"`
	RecoveryCount int       `json:"recoveryCount"`
	CandidateID   *string   `json:"candidateId"`
	ErrorCode     string    `json:"errorCode"`
	Actor         string    `json:"actor"`
	OccurredAt    time.Time `json:"occurredAt"`
}

func (q JobQueue) History(ctx context.Context, id string, after int64) ([]JobAudit, error) {
	if !hashRE.MatchString(id) || after < 0 {
		return nil, errors.New("invalid job history query")
	}
	if _, err := q.Status(ctx, id); err != nil {
		return nil, err
	}
	rows, err := q.Pool.Query(ctx, `SELECT sequence,event_type,previous_state,state,attempts,recovery_count,candidate_id,error_code,actor,occurred_at FROM tickergarden.treasury_job_audit WHERE job_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100`, id, after)
	if err != nil {
		return nil, errors.New("cannot read Treasury job history")
	}
	defer rows.Close()
	out := []JobAudit{}
	for rows.Next() {
		var event JobAudit
		if err = rows.Scan(&event.Sequence, &event.Event, &event.PreviousState, &event.State, &event.Attempts, &event.RecoveryCount, &event.CandidateID, &event.ErrorCode, &event.Actor, &event.OccurredAt); err != nil {
			return nil, errors.New("invalid job audit row")
		}
		out = append(out, event)
	}
	if rows.Err() != nil {
		return nil, errors.New("cannot finish Treasury history query")
	}
	return out, nil
}

type Recovery struct {
	OperationID   string `json:"operationId"`
	JobID         string `json:"jobId"`
	RecoveryCount int    `json:"recoveryCount"`
	ObservedHash  string `json:"observedBlockHash"`
}

func validRecovery(id, operation, reason string, expected int) bool {
	if !hashRE.MatchString(id) || !hashRE.MatchString(operation) || operation != strings.ToLower(operation) || expected < 0 || expected >= 2147483647 || !utf8.ValidString(reason) || utf8.RuneCountInString(reason) > 512 || strings.TrimSpace(reason) != reason || reason == "" {
		return false
	}
	for _, r := range reason {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// Recover requires a dedicated operator connection. Session identity is recorded
// by PostgreSQL; caller-provided names cannot impersonate the database actor.
// A stable operation ID makes an uncertain retry idempotent; expected revision
// prevents an old approval from reviving a later failed processing generation.
func (q JobQueue) Recover(ctx context.Context, rpc deployment.BindingObserver, id, operation, reason string, expected int) (Recovery, error) {
	fail := func(err error) (Recovery, error) { return Recovery{}, err }
	if !validRecovery(id, operation, reason, expected) {
		return fail(errors.New("invalid Treasury recovery request"))
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return fail(errors.New("cannot open Treasury recovery"))
	}
	defer tx.Rollback(ctx)
	// Serialize the operation key as well as the job, including collisions across jobs.
	var locked bool
	if err = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 820))`, operation).Scan(&locked); err != nil || !locked {
		return fail(errors.New("Treasury recovery operation busy"))
	}
	var prior Recovery
	var oldReason string
	var oldExpected int
	err = tx.QueryRow(ctx, `SELECT operation_id,job_id,recovery_count,observed_hash,reason,expected_recovery FROM tickergarden.treasury_job_recoveries WHERE operation_id=$1`, operation).Scan(&prior.OperationID, &prior.JobID, &prior.RecoveryCount, &prior.ObservedHash, &oldReason, &oldExpected)
	if err == nil {
		if prior.JobID != id || oldReason != reason || oldExpected != expected {
			return fail(errors.New("recovery operation ID already belongs to another request"))
		}
		return prior, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fail(errors.New("cannot read recovery operation"))
	}
	var payload []byte
	var chain uint64
	var mh, state string
	var generation int
	err = tx.QueryRow(ctx, `SELECT payload,chain_id,manifest_hash,state,recovery_count FROM tickergarden.treasury_jobs WHERE id=$1 FOR UPDATE`, id).Scan(&payload, &chain, &mh, &state, &generation)
	if err != nil {
		return fail(errors.New("recovery job unavailable"))
	}
	if state != "dead" || generation != expected {
		return fail(errors.New("recovery requires current dead job revision"))
	}
	var spec JobSpec
	if hash(payload) != id || json.Unmarshal(payload, &spec) != nil {
		return fail(errors.New("corrupted job cannot be recovered"))
	}
	canonical, normalized, manifestHash, err := canonicalJob(spec)
	if err != nil || string(normalized) != string(payload) || chain != canonical.Manifest.ChainID || mh != manifestHash {
		return fail(errors.New("recovery job provenance mismatch"))
	}
	block, err := rpc.Header(ctx, "finalized")
	if err != nil {
		return fail(errors.New("recovery request RPC unavailable"))
	}
	observed, err := deployment.ObserveTreasuryRequest(ctx, rpc, canonical.Manifest, block, canonical.Input.MarketID, canonical.Input.EpochID)
	if err != nil {
		return fail(errors.New("recovery requires a live verified root request"))
	}
	if err = MatchRequest(canonical.Input, observed); err != nil {
		return fail(errors.New("recovery request no longer matches frozen input"))
	}
	result := Recovery{OperationID: operation, JobID: id, RecoveryCount: generation + 1, ObservedHash: block.Hash}
	_, err = tx.Exec(ctx, `INSERT INTO tickergarden.treasury_job_recoveries(operation_id,job_id,expected_recovery,recovery_count,reason,observed_hash) VALUES($1,$2,$3,$4,$5,$6)`, operation, id, expected, result.RecoveryCount, reason, block.Hash)
	if err != nil {
		return fail(errors.New("cannot record recovery authorization"))
	}
	_, err = tx.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET state='ready',attempts=0,recovery_count=recovery_count+1,error_code='',available_at=now(),updated_at=now() WHERE id=$1`, id)
	if err != nil {
		return fail(errors.New("cannot reopen Treasury job"))
	}
	if err = tx.Commit(ctx); err != nil {
		return fail(errors.New("recovery commit uncertain; retry the same operation ID"))
	}
	return result, nil
}
