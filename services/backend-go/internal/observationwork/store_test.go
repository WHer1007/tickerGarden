package observationwork

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/migration"
)

func queueDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if os.Getenv("TG_TEST_OBSERVATION_WORK") != "1" {
		t.Skip("set TG_TEST_OBSERVATION_WORK=1 and TG_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	cfg, e := pgx.ParseConfig(os.Getenv("TG_TEST_DATABASE_URL"))
	if e != nil {
		t.Fatal("invalid test database")
	}
	admin, e := pgx.ConnectConfig(ctx, cfg)
	if e != nil {
		t.Fatal("test database unavailable")
	}
	t.Cleanup(func() { admin.Close(ctx) })
	name := fmt.Sprintf("tg_observation_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, e = admin.Exec(ctx, "CREATE DATABASE "+quoted); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		_, e := admin.Exec(ctx, "DROP DATABASE "+quoted+" WITH (FORCE)")
		if e != nil {
			t.Error(e)
		}
	})
	cfg = cfg.Copy()
	cfg.Database = name
	db := stdlib.OpenDB(*cfg)
	defer db.Close()
	m, e := migration.New(db)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = m.Up(ctx); e != nil {
		t.Fatal(e)
	}
	pc, e := pgxpool.ParseConfig(cfg.ConnString())
	if e != nil {
		t.Fatal(e)
	}
	pc.ConnConfig = cfg
	pc.MaxConns = 4
	p, e := pgxpool.NewWithConfig(ctx, pc)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(p.Close)
	return p
}
func queueRequests(t *testing.T) []Request {
	t.Helper()
	m := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 421614, GenesisHash: "0x" + strings.Repeat("1", 64), Contracts: []deployment.Contract{{Module: "UserStockVault", Address: "0x" + strings.Repeat("1", 40), RuntimeCodeHash: deployment.Hash([]byte{0})}}}
	r, e := Plan(m, chainrpc.Header{Number: "0x1", Hash: "0x" + strings.Repeat("2", 64), Timestamp: "0x1"}, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func queueBatch(r Request) deployment.ObservationBatch {
	scope := deployment.FeeObservationScope
	if r.Kind == "holders" {
		scope = deployment.HolderObservationScope
	}
	return deployment.ObservationBatch{Scope: scope, ChainID: r.Manifest.ChainID, BlockNumber: r.Block.Number, BlockHash: r.Block.Hash, Observations: []deployment.StateObservation{}}
}
func TestQueueSlowScopeRetryAndRestart(t *testing.T) {
	p := queueDB(t)
	ctx := context.Background()
	rs := queueRequests(t)
	s := Store{Pool: p, Concurrency: 2, Timeout: 100 * time.Millisecond}
	var fees, holders atomic.Int32
	runner := func(c context.Context, r Request) (deployment.ObservationBatch, error) {
		if r.Kind == "fees" {
			fees.Add(1)
			<-c.Done()
			return deployment.ObservationBatch{}, c.Err()
		}
		holders.Add(1)
		return queueBatch(r), nil
	}
	if _, _, e := s.Resolve(ctx, rs, runner); !errors.Is(e, ErrPending) {
		t.Fatalf("partial evidence published: %v", e)
	}
	var complete int
	if e := p.QueryRow(ctx, `SELECT count(*) FROM tickergarden.observation_work WHERE state='complete'`).Scan(&complete); e != nil || complete != 1 {
		t.Fatalf("independent work lost %d %v", complete, e)
	}
	// A new process sees the completed holder scope and only retries the failed one.
	if _, e := p.Exec(ctx, `UPDATE tickergarden.observation_work SET retry_after=now()`); e != nil {
		t.Fatal(e)
	}
	restarted := Store{Pool: p}
	runner = func(c context.Context, r Request) (deployment.ObservationBatch, error) {
		if r.Kind == "fees" {
			fees.Add(1)
		} else {
			holders.Add(1)
		}
		return queueBatch(r), nil
	}
	if _, _, e := restarted.Resolve(ctx, rs, runner); e != nil {
		t.Fatal(e)
	}
	if fees.Load() != 2 || holders.Load() != 1 {
		t.Fatalf("unexpected executions %d %d", fees.Load(), holders.Load())
	}
	if _, _, e := restarted.Resolve(ctx, rs, runner); e != nil {
		t.Fatal(e)
	}
	if fees.Load() != 2 || holders.Load() != 1 {
		t.Fatal("cache did not survive restart")
	}
}
func TestQueueExpiredLeaseFencesOldCompletion(t *testing.T) {
	p := queueDB(t)
	ctx := context.Background()
	r := queueRequests(t)[0]
	s := Store{Pool: p}
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, e := s.resolveOne(ctx, r, time.Second, func(context.Context, Request) (deployment.ObservationBatch, error) {
			close(started)
			<-release
			return queueBatch(r), nil
		})
		done <- e
	}()
	select {
	case <-started:
	case e := <-done:
		t.Fatalf("claim failed: %v", e)
	case <-time.After(5 * time.Second):
		t.Fatal("claim timeout")
	}
	if _, e := p.Exec(ctx, `UPDATE tickergarden.observation_work SET lease_until=now()-interval '1 second'`); e != nil {
		t.Fatal(e)
	}
	if _, e := s.resolveOne(ctx, r, time.Second, func(context.Context, Request) (deployment.ObservationBatch, error) { return queueBatch(r), nil }); e != nil {
		t.Fatal(e)
	}
	close(release)
	if e := <-done; !errors.Is(e, ErrPending) {
		t.Fatalf("stale worker accepted %v", e)
	}
	var gen, attempt int
	if e := p.QueryRow(ctx, `SELECT generation,attempts FROM tickergarden.observation_work`).Scan(&gen, &attempt); e != nil || gen != 2 || attempt != 2 {
		t.Fatalf("lease recovery %d/%d %v", gen, attempt, e)
	}
}
func TestQueueCorruptionAndAnchorIsolation(t *testing.T) {
	p := queueDB(t)
	ctx := context.Background()
	rs := queueRequests(t)
	s := Store{Pool: p}
	var calls atomic.Int32
	run := func(_ context.Context, r Request) (deployment.ObservationBatch, error) {
		calls.Add(1)
		return queueBatch(r), nil
	}
	if _, _, e := s.Resolve(ctx, rs, run); e != nil {
		t.Fatal(e)
	}
	for i := range rs {
		rs[i].Block.Hash = "0x" + strings.Repeat("3", 64)
	}
	if _, _, e := s.Resolve(ctx, rs, run); e != nil {
		t.Fatal(e)
	}
	if calls.Load() != 4 {
		t.Fatal("reorg reused old result")
	}
	if _, e := p.Exec(ctx, `UPDATE tickergarden.observation_work SET result='{}'::bytea`); e != nil {
		t.Fatal(e)
	}
	if _, _, e := s.Resolve(ctx, rs, run); e == nil {
		t.Fatal("corruption accepted")
	}
}

func TestQueueMultiMarketRateLimitBudget(t *testing.T) {
	p := queueDB(t)
	ctx := context.Background()
	seed := queueRequests(t)[0]
	markets := map[string]deployment.MarketDiscovery{}
	for i := 0; i < 16; i++ {
		id := fmt.Sprintf("0x%064x", i+1)
		markets[id] = deployment.MarketDiscovery{MarketID: id, State: map[string]any{"quoteAsset": fmt.Sprintf("0x%040x", i*2+1), "memeToken": fmt.Sprintf("0x%040x", i*2+2), "stakingEnabled": false}}
	}
	rs, e := Plan(seed.Manifest, seed.Block, markets, nil)
	if e != nil || len(rs) != 32 {
		t.Fatalf("groups %d %v", len(rs), e)
	}
	s := Store{Pool: p, Concurrency: 2}
	var active, peak, calls atomic.Int32
	run := func(c context.Context, r Request) (deployment.ObservationBatch, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for {
			old := peak.Load()
			if n <= old || peak.CompareAndSwap(old, n) {
				break
			}
		}
		calls.Add(1)
		time.Sleep(time.Millisecond)
		if r.Kind == "fees" {
			return deployment.ObservationBatch{}, errors.New("injected HTTP 429")
		}
		return queueBatch(r), nil
	}
	if _, _, e = s.Resolve(ctx, rs, run); !errors.Is(e, ErrPending) {
		t.Fatalf("partial accepted %v", e)
	}
	var complete int
	if e = p.QueryRow(ctx, `SELECT count(*) FROM tickergarden.observation_work WHERE state='complete'`).Scan(&complete); e != nil || complete != 16 {
		t.Fatalf("healthy scopes not complete %d %v", complete, e)
	}
	if calls.Load() != 32 || peak.Load() > 2 {
		t.Fatalf("budget/calls %d %d", peak.Load(), calls.Load())
	}
	if _, e = p.Exec(ctx, `UPDATE tickergarden.observation_work SET retry_after=now()`); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.Resolve(ctx, rs, func(context.Context, Request) (deployment.ObservationBatch, error) {
		return deployment.ObservationBatch{}, errors.New("still throttled")
	}); !errors.Is(e, ErrPending) {
		t.Fatal("throttled block ready")
	}
	var attempts int
	if e = p.QueryRow(ctx, `SELECT sum(attempts) FROM tickergarden.observation_work`).Scan(&attempts); e != nil || attempts != 48 {
		t.Fatalf("healthy scopes retried %d %v", attempts, e)
	}
	t.Logf("syntheticMarkets=16 jobs=32 peakConcurrent=%d completedDespite429=%d fullPublication=false", peak.Load(), complete)
}
