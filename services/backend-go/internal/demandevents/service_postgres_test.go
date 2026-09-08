package demandevents

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"io/fs"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/migrations"
	"time"
)

type demandTestSource struct {
	headers, logs    atomic.Int32
	lastFrom, lastTo atomic.Uint64
	head             atomic.Uint64
	slow             <-chan struct{}
}

func (s *demandTestSource) Header(context.Context, string) (chainrpc.Header, error) {
	s.headers.Add(1)
	n := s.head.Load()
	if n == 0 {
		n = 3
	}
	return chainrpc.Header{Number: fmt.Sprintf("0x%x", n), Timestamp: "0x1", Hash: "0x" + strings.Repeat("a", 64)}, nil
}
func (s *demandTestSource) ProjectLogs(ctx context.Context, _ []string, _ []string, from, to uint64) ([]chainrpc.Log, error) {
	s.logs.Add(1)
	s.lastFrom.Store(from)
	s.lastTo.Store(to)
	if s.slow != nil {
		select {
		case <-s.slow:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return nil, nil
}

func demandTestDB(t *testing.T) (*pgxpool.Pool, func()) {
	t.Helper()
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TG_TEST_DATABASE_URL to a local PostgreSQL server with CREATEDB permission")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("tg_demand_events_%d", time.Now().UnixNano())
	ident := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+ident); err != nil {
		t.Fatal(err)
	}
	cleanup := func() {
		c, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		admin.Exec(c, "DROP DATABASE "+ident+" WITH (FORCE)")
		admin.Close(c)
	}
	tcfg := cfg.Copy()
	tcfg.Database = name
	db := stdlib.OpenDB(*tcfg)
	p, err := migration.New(db)
	if err != nil {
		cleanup()
		t.Fatal(err)
	}
	files, _ := fs.Glob(migrations.Files, "*.sql")
	for i, f := range files {
		v, e := strconv.Atoi(strings.SplitN(f, "_", 2)[0])
		if e != nil || v != i+1 {
			cleanup()
			t.Fatal("invalid migration inventory")
		}
	}
	if _, err = p.Up(ctx); err != nil {
		cleanup()
		t.Fatal(err)
	}
	u, _ := url.Parse(dsn)
	u.Path = "/" + name
	pc, err := pgxpool.ParseConfig(u.String())
	if err != nil {
		cleanup()
		t.Fatal(err)
	}
	pc.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		cleanup()
		t.Fatal(err)
	}
	return pool, func() { pool.Close(); db.Close(); cleanup() }
}
func mustConfig(t *testing.T, dsn string) *pgx.ConnConfig {
	c, e := pgx.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	return c
}
func demandScope(id string) Scope {
	return Scope{ID: id, ChainID: 4663, Start: 1, Modules: map[string]string{"0x" + strings.Repeat("1", 40): "ProtocolFeeVault"}}
}

func TestServiceFetchPersistenceAndNoStartupRPC(t *testing.T) {
	pool, done := demandTestDB(t)
	defer done()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	src := &demandTestSource{}
	s, err := New(ctx, pool, src, demandScope("scope-persist"))
	if err != nil {
		t.Fatal(err)
	}
	if src.headers.Load() != 0 || src.logs.Load() != 0 {
		t.Fatal("startup performed RPC")
	}
	if err = s.Fetch(ctx, s.Default); err != nil {
		t.Fatal(err)
	}
	if src.headers.Load() != 1 || src.logs.Load() != 1 {
		t.Fatalf("RPC counts=%d/%d", src.headers.Load(), src.logs.Load())
	}
	if _, err = s.Load(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if err = s.Fetch(ctx, s.Default); err != nil {
		t.Fatal(err)
	}
	if src.headers.Load() != 1 {
		t.Fatal("TTL did not suppress reread")
	}
	cancel()
	time.Sleep(20 * time.Millisecond)
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	s2, err := New(ctx2, pool, src, demandScope("scope-persist"))
	if err != nil {
		t.Fatal(err)
	}
	if err = s2.Fetch(ctx2, s2.Default); err != nil {
		t.Fatal(err)
	}
	if src.headers.Load() != 1 {
		t.Fatal("restart replayed observed range")
	}
}

func queueFixture(t *testing.T, pool *pgxpool.Pool, id string, jobs int) Scope {
	t.Helper()
	sc := demandScope(id)
	raw, _ := json.Marshal(sc)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `INSERT INTO tickergarden.demand_event_scopes(scope_id,chain_id,config,start_block,read_through,processed_through) VALUES($1,$2,$3,1,$4,0)`, id, sc.ChainID, raw, jobs)
	if err != nil {
		t.Fatal(err)
	}
	for n := 1; n <= jobs; n++ {
		_, err = pool.Exec(ctx, `INSERT INTO tickergarden.demand_event_ranges(scope_id,from_block,to_block,event_count) VALUES($1,$2,$2,1)`, id, n)
		if err == nil {
			_, err = pool.Exec(ctx, `INSERT INTO tickergarden.demand_event_jobs(scope_id,from_block,logs) VALUES($1,$2,$3)`, id, n, fmt.Sprintf(`[{"blockNumber":"%s"}]`, fmt.Sprintf("0x%x", n)))
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	return sc
}

func TestServiceFetchDoesNotWaitForSlowProcessor(t *testing.T) {
	pool, done := demandTestDB(t)
	defer done()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sc := queueFixture(t, pool, "slow", 1)
	entered, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	src := &demandTestSource{}
	s := &Service{Pool: pool, Source: src, Process: func(ctx context.Context, _ pgx.Tx, _ Scope, _ []chainrpc.Log) error {
		close(entered)
		select {
		case <-release:
		case <-ctx.Done():
		}
		return nil
	}}
	processing := make(chan struct{})
	go func() { s.ProcessNext(ctx); close(processing) }()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("handler never entered")
	}
	if err := s.Fetch(ctx, sc); err != nil {
		t.Fatal(err)
	}
	var read, processed int
	if err := pool.QueryRow(ctx, `SELECT read_through,processed_through FROM tickergarden.demand_event_scopes WHERE scope_id=$1`, sc.ID).Scan(&read, &processed); err != nil {
		t.Fatal(err)
	}
	if read != 3 || processed != 0 || src.logs.Load() != 1 {
		t.Fatalf("read=%d processed=%d calls=%d", read, processed, src.logs.Load())
	}
	select {
	case <-processing:
		t.Fatal("processor was not blocked")
	default:
	}
}

func TestServiceHandlerScopesAreIndependentAndOrdered(t *testing.T) {
	pool, done := demandTestDB(t)
	defer done()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	queueFixture(t, pool, "a", 2)
	queueFixture(t, pool, "b", 2)
	entered := make(chan string, 2)
	release := make(chan struct{})
	var mu sync.Mutex
	order := map[string][]string{}
	s := &Service{Pool: pool, Process: func(ctx context.Context, _ pgx.Tx, sc Scope, logs []chainrpc.Log) error {
		mu.Lock()
		order[sc.ID] = append(order[sc.ID], logs[0].BlockNumber)
		mu.Unlock()
		entered <- sc.ID
		select {
		case <-release:
		case <-ctx.Done():
		}
		return nil
	}}
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); s.ProcessNext(ctx) }()
	}
	seen := map[string]bool{}
	for i := 0; i < 2; i++ {
		select {
		case id := <-entered:
			seen[id] = true
		case <-ctx.Done():
			close(release)
			wg.Wait()
			t.Fatal("independent scope blocked")
		}
	}
	close(release)
	wg.Wait()
	if len(seen) != 2 {
		t.Fatal("same scope ran concurrently")
	}
	for i := 0; i < 2; i++ {
		if ok, _, err := s.ProcessNext(ctx); !ok || err != nil {
			t.Fatalf("next: %v %v", ok, err)
		}
	}
	for _, id := range []string{"a", "b"} {
		if fmt.Sprint(order[id]) != "[0x1 0x2]" {
			t.Fatalf("wrong order: %v", order)
		}
	}
}

func TestServiceFailedHeadBlocksLaterSameScope(t *testing.T) {
	pool, done := demandTestDB(t)
	defer done()
	ctx := context.Background()
	queueFixture(t, pool, "a", 2)
	queueFixture(t, pool, "b", 1)
	s := &Service{Pool: pool, Process: func(_ context.Context, _ pgx.Tx, sc Scope, logs []chainrpc.Log) error {
		if sc.ID == "a" {
			if logs[0].BlockNumber != "0x1" {
				t.Error("later event bypassed failed head")
			}
			return fmt.Errorf("failed")
		}
		return nil
	}}
	if ok, _, err := s.ProcessNext(ctx); !ok || err == nil {
		t.Fatalf("expected failure: %v %v", ok, err)
	}
	if ok, _, err := s.ProcessNext(ctx); !ok || err != nil {
		t.Fatalf("other scope blocked: %v %v", ok, err)
	}
	for i := 1; i < 5; i++ {
		_, err := pool.Exec(ctx, `UPDATE tickergarden.demand_event_jobs SET retry_at='-infinity' WHERE scope_id='a' AND from_block=1`)
		if err != nil {
			t.Fatal(err)
		}
		if ok, _, err := s.ProcessNext(ctx); !ok || err == nil {
			t.Fatal("head retry missing")
		}
	}
	if ok, _, err := s.ProcessNext(ctx); ok || err != nil {
		t.Fatal("failed head was bypassed")
	}
	var state string
	var attempts int
	if err := pool.QueryRow(ctx, `SELECT state,attempts FROM tickergarden.demand_event_jobs WHERE scope_id='a' AND from_block=1`).Scan(&state, &attempts); err != nil || state != "failed" || attempts != 5 {
		t.Fatalf("state=%s attempts=%d err=%v", state, attempts, err)
	}
	if err := pool.QueryRow(ctx, `SELECT state FROM tickergarden.demand_event_jobs WHERE scope_id='a' AND from_block=2`).Scan(&state); err != nil || state != "pending" {
		t.Fatal("later job advanced")
	}
}

func TestServiceConcurrentLoadCoalescesFetch(t *testing.T) {
	pool, done := demandTestDB(t)
	defer done()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	src := &demandTestSource{}
	s, err := New(ctx, pool, src, demandScope("scope-coalesce"))
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = s.Load(ctx, 1) }()
	}
	wg.Wait()
	deadline := time.Now().Add(2 * time.Second)
	for src.logs.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := src.logs.Load(); got != 1 {
		t.Fatalf("coalesced Load issued %d log queries", got)
	}
}

func TestServiceFromHeadReadsOnlyCurrentHeadAndPersists(t *testing.T) {
	pool, done := demandTestDB(t)
	defer done()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	src := &demandTestSource{}
	src.head.Store(42)
	scope := demandScope("scope-from-head")
	scope.Start = 7
	scope.FromHead = true
	s, err := New(ctx, pool, src, scope)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Fetch(ctx, scope); err != nil {
		t.Fatal(err)
	}
	if src.lastFrom.Load() != 42 || src.lastTo.Load() != 42 {
		t.Fatalf("from-head queried %d..%d", src.lastFrom.Load(), src.lastTo.Load())
	}
	feed, err := s.Load(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if feed.HistoryFrom != "42" || feed.Finality != "head" || feed.FinalizedThrough != "" {
		t.Fatalf("unexpected from-head feed: %+v", feed)
	}
	before := src.logs.Load()
	cancel()
	time.Sleep(20 * time.Millisecond)
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	s2, err := New(ctx2, pool, src, scope)
	if err != nil {
		t.Fatal(err)
	}
	if err = s2.Fetch(ctx2, scope); err != nil {
		t.Fatal(err)
	}
	if src.logs.Load() != before {
		t.Fatalf("restart replayed from-head logs: before=%d after=%d", before, src.logs.Load())
	}
}
