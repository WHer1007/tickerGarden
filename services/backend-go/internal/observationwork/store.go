package observationwork

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

// Store uses a separate connection pool: the caller may hold a financial
// transaction which must not own (or roll back) reusable observation jobs.
// Only trusted backend database credentials may write this evidence cache.
type Store struct {
	Pool        *pgxpool.Pool
	Concurrency int
	Timeout     time.Duration
}

type Runner func(context.Context, Request) (deployment.ObservationBatch, error)

// Resolve attempts every dependency group, retaining independent successes even
// when another fails. A partial set always returns ErrPending, never evidence.
// Claims expire; generation fencing prevents a stale worker replacing a retry.
func (s *Store) Resolve(ctx context.Context, requests []Request, run Runner) (deployment.ObservationBatch, deployment.ObservationBatch, error) {
	var empty deployment.ObservationBatch
	if s.Pool == nil || len(requests) == 0 || len(requests) > 8192 {
		return empty, empty, errors.New("invalid observation queue")
	}
	n := s.Concurrency
	if n == 0 {
		n = 2
	}
	if n < 1 || n > 4 {
		return empty, empty, errors.New("observation concurrency must be 1..4")
	}
	timeout := s.Timeout
	if timeout == 0 {
		timeout = 45 * time.Second
	}
	if timeout < time.Millisecond || timeout > 45*time.Second {
		return empty, empty, errors.New("invalid observation timeout")
	}
	// Results are disposable evidence caches, not audit records. Bounded cleanup
	// prevents abandoned requests and historical replay caches growing forever.
	if _, err := s.Pool.Exec(ctx, `DELETE FROM tickergarden.observation_work WHERE request_key IN (SELECT request_key FROM tickergarden.observation_work WHERE updated_at < now()-interval '24 hours' AND (state<>'running' OR lease_until<now()) ORDER BY updated_at LIMIT 100)`); err != nil {
		return empty, empty, err
	}
	batches := make([]deployment.ObservationBatch, len(requests))
	errs := make([]error, len(requests))
	jobs := make(chan int)
	var wg sync.WaitGroup
	for k := 0; k < n; k++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				batches[i], errs[i] = s.resolveOne(ctx, requests[i], timeout, run)
			}
		}()
	}
	for i := range requests {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return empty, empty, err
		}
	}
	return Merge(requests, batches)
}

func (s *Store) resolveOne(ctx context.Context, r Request, timeout time.Duration, run Runner) (deployment.ObservationBatch, error) {
	var empty deployment.ObservationBatch
	raw, key, err := r.Encode()
	if err != nil {
		return empty, err
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO tickergarden.observation_work(request_key,request) VALUES($1,$2) ON CONFLICT DO NOTHING`, key, raw)
	if err != nil {
		return empty, err
	}
	var generation int64
	err = s.Pool.QueryRow(ctx, `UPDATE tickergarden.observation_work SET state='running',generation=generation+1,attempts=attempts+1,lease_until=now()+interval '60 seconds',updated_at=now() WHERE request_key=$1 AND request=$2 AND ((state='pending' AND retry_after<=now()) OR (state='running' AND lease_until<now())) RETURNING generation`, key, raw).Scan(&generation)
	if errors.Is(err, pgx.ErrNoRows) {
		var result []byte
		var digest *string
		var stored []byte
		err = s.Pool.QueryRow(ctx, `SELECT request,result,result_digest FROM tickergarden.observation_work WHERE request_key=$1`, key).Scan(&stored, &result, &digest)
		if err != nil {
			return empty, err
		}
		if Digest(stored) != key {
			return empty, errors.New("corrupt observation request")
		}
		if digest == nil {
			return empty, ErrPending
		}
		return DecodeResult(r, result, *digest)
	}
	if err != nil {
		return empty, err
	}
	jobCtx, cancel := context.WithTimeout(ctx, timeout)
	b, err := run(jobCtx, r)
	cancel()
	if err == nil {
		err = Validate(r, b)
	}
	if err == nil {
		result, e := json.Marshal(b)
		if e != nil || len(result) > 16<<20 {
			err = errors.New("invalid observation result size")
		} else {
			tag, e := s.Pool.Exec(ctx, `UPDATE tickergarden.observation_work SET state='complete',result=$3,result_digest=$4,lease_until=NULL,updated_at=now() WHERE request_key=$1 AND generation=$2 AND state='running' AND lease_until>now()`, key, generation, result, Digest(result))
			if e != nil {
				return empty, e
			}
			if tag.RowsAffected() != 1 {
				return empty, ErrPending
			}
			return b, nil
		}
	}
	// Do not persist upstream error text: provider URLs may contain credentials.
	// A cancelled process can leave a running job; its lease permits recovery.
	_, e := s.Pool.Exec(ctx, `UPDATE tickergarden.observation_work SET state='pending',lease_until=NULL,retry_after=now()+LEAST(attempts,30)*interval '1 second',updated_at=now() WHERE request_key=$1 AND generation=$2 AND state='running'`, key, generation)
	if e != nil {
		return empty, e
	}
	return empty, ErrPending
}
