package settlement

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"testing"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestIsolatedSettlementWork(t *testing.T) {
	dsn := os.Getenv("TG_SETTLEMENT_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated settlement database not supplied")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 12)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var raw []byte
	var original WorkResult
	err = pool.QueryRow(ctx, `SELECT job_key,status,check_sequence,payload FROM tickergarden.settlement_work ORDER BY sequence LIMIT 1`).Scan(&original.JobKey, &original.Status, &original.CheckSequence, &raw)
	if err != nil || original.Status != "checked_unsigned" {
		t.Fatal(original, err)
	}
	var spec WorkSpec
	if json.Unmarshal(raw, &spec) != nil {
		t.Fatal("bad work")
	}
	s := Store{Pool: pool, ChainID: spec.Manifest.ChainID}
	w := Worker{Store: s, Scope: WorkScope{ChainID: s.ChainID, GenesisHash: spec.Manifest.GenesisHash, Operator: spec.Selection.Operator}}
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := s.Enqueue(ctx, spec)
			if e != nil || r.JobKey != original.JobKey || r.Status != original.Status {
				t.Errorf("duplicate enqueue %v %v", r, e)
			}
		}()
	}
	wg.Wait()
	var v VerifiedConversion
	var evidence []byte
	err = pool.QueryRow(ctx, `SELECT chain_id,genesis_hash,market_id,request_digest,block_hash,payload FROM tickergarden.settlement_checks WHERE sequence=$1`, *original.CheckSequence).Scan(&v.chainID, &v.genesis, &v.market, &v.request, &v.block, &evidence)
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Manifest json.RawMessage
		Result   json.RawMessage
	}
	if json.Unmarshal(evidence, &envelope) != nil {
		t.Fatal("bad evidence")
	}
	v.manifest = envelope.Manifest
	v.payload = envelope.Result
	spec.RunID = "retry-test"
	queued, err := s.Enqueue(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	conflict := spec
	conflict.DeadlineSeconds = 60
	if _, err = s.Enqueue(ctx, conflict); err == nil {
		t.Fatal("run retarget accepted")
	}
	conflict = spec
	conflict.RunID = "competing-run"
	if _, err = s.Enqueue(ctx, conflict); err == nil {
		t.Fatal("multiple active market jobs")
	}
	claims := make(chan workClaim, 12)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, e := w.claim(ctx)
			if e != nil {
				t.Error(e)
			}
			if c.key != "" {
				claims <- c
			}
		}()
	}
	wg.Wait()
	close(claims)
	var first workClaim
	count := 0
	for c := range claims {
		first = c
		count++
	}
	if count != 1 || first.key != queued.JobKey {
		t.Fatal("multiple owners", count)
	}
	foreign := w
	foreign.Scope.Operator = "0x000000000000000000000000000000000000dead"
	if c, e := foreign.claim(ctx); e != nil || c.key != "" {
		t.Fatal("cross operator claim", c, e)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_work SET claim_until=clock_timestamp()-interval '1 second' WHERE job_key=$1`, first.key); err != nil {
		t.Fatal(err)
	}
	second, err := w.claim(ctx)
	if err != nil || second.generation <= first.generation {
		t.Fatal(second, err)
	}
	if _, err = w.finish(ctx, first, v, nil); err == nil {
		t.Fatal("stale owner completed")
	}
	r, err := w.finish(ctx, second, VerifiedConversion{}, errors.New("fixture failure"))
	if err != nil || r.Status != "retry" {
		t.Fatal(r, err)
	}
	if c, e := w.claim(ctx); e != nil || c.key != "" {
		t.Fatal("ignored backoff", c, e)
	}
	for attempt := 3; attempt <= 5; attempt++ {
		if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_work SET due_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, first.key); err != nil {
			t.Fatal(err)
		}
		c, e := w.claim(ctx)
		if e != nil || c.attempts != attempt {
			t.Fatal(c, e)
		}
		r, e = w.finish(ctx, c, VerifiedConversion{}, errors.New("fixture failure"))
		if e != nil {
			t.Fatal(e)
		}
	}
	if r.Status != "failed" {
		t.Fatal("not terminal", r)
	}
	if c, e := w.claim(ctx); e != nil || c.key != "" {
		t.Fatal("sixth attempt", c, e)
	}
	spec.RunID = "crashed-last-attempt"
	r, err = s.Enqueue(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	c, err := w.claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_work SET attempts=4,claim_until='-infinity' WHERE job_key=$1`, c.key); err != nil {
		t.Fatal(err)
	}
	c, err = w.claim(ctx)
	if err != nil || c.attempts != 5 {
		t.Fatal(c, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_work SET claim_until='-infinity' WHERE job_key=$1`, c.key); err != nil {
		t.Fatal(err)
	}
	if c, e := w.claim(ctx); e != nil || c.key != "" {
		t.Fatal("reclaimed sixth crash", c, e)
	}
	var status string
	if err = pool.QueryRow(ctx, `SELECT status FROM tickergarden.settlement_work WHERE job_key=$1`, r.JobKey).Scan(&status); err != nil || status != "failed" {
		t.Fatal(status, err)
	}
	spec.RunID = "atomic-finish"
	if _, err = s.Enqueue(ctx, spec); err != nil {
		t.Fatal(err)
	}
	c, err = w.claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.finish(ctx, c, v, nil)
	if err != nil || r.Status != "checked_unsigned" || r.CheckSequence == nil || *r.CheckSequence != *original.CheckSequence {
		t.Fatal(r, err)
	}
	if _, err = w.finish(ctx, c, v, nil); err == nil {
		t.Fatal("finished twice")
	}
}
