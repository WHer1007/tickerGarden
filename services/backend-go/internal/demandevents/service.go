// Package demandevents reads scoped logs only on demand and processes persisted
// batches in independent ordered queues. It never verifies deployments or emits
// trusted financial snapshots.
package demandevents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"sort"
	"sync"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/eventfeed"
	"tickergarden/backend/internal/events"
	"time"
)

type Source interface {
	Header(context.Context, string) (chainrpc.Header, error)
	ProjectLogs(context.Context, []string, []string, uint64, uint64) ([]chainrpc.Log, error)
}
type Scope struct {
	ID       string            `json:"id"`
	FromHead bool              `json:"fromHead,omitempty"`
	ChainID  uint64            `json:"chainId"`
	Start    uint64            `json:"startBlock"`
	Modules  map[string]string `json:"modules"`
}
type Handler func(context.Context, pgx.Tx, Scope, []chainrpc.Log) error
type Service struct {
	creatorMu sync.Mutex
	Pool      *pgxpool.Pool
	Source    Source
	Default   Scope
	TTL       time.Duration
	Process   Handler
	ctx       context.Context
	mu        sync.Mutex
	fetching  map[string]bool
	slots     chan struct{}
	wake      chan struct{}
	headMu    sync.Mutex
	head      chainrpc.Header
	headAt    time.Time
}

func New(ctx context.Context, pool *pgxpool.Pool, source Source, scope Scope, handlers ...Handler) (*Service, error) {
	if pool == nil || source == nil || scope.ID == "" || scope.Start == 0 || len(scope.Modules) == 0 || len(scope.Modules) > 64 {
		return nil, errors.New("invalid demand scope")
	}
	for a, m := range scope.Modules {
		if len(a) != 42 || !events.HasModule(m) || m == "UniswapV4PoolManager" {
			return nil, errors.New("demand scope must bind project modules")
		}
	}
	s := &Service{Pool: pool, Source: source, Default: scope, TTL: 20 * time.Second, ctx: ctx, fetching: map[string]bool{}, slots: make(chan struct{}, 4), wake: make(chan struct{}, 4)}
	if scope.FromHead {
		s.TTL = 10 * time.Second
	}
	raw, _ := json.Marshal(scope)
	_, err := pool.Exec(ctx, `INSERT INTO tickergarden.demand_event_scopes(scope_id,chain_id,config,start_block,read_through,processed_through) VALUES($1,$2,$3,$4::bigint,$4::bigint-1,$4::bigint-1) ON CONFLICT DO NOTHING`, scope.ID, scope.ChainID, raw, scope.Start)
	if err != nil {
		return nil, err
	}
	var saved []byte
	if pool.QueryRow(ctx, `SELECT config FROM tickergarden.demand_event_scopes WHERE scope_id=$1`, scope.ID).Scan(&saved) != nil {
		return nil, errors.New("missing demand scope")
	}
	var old Scope
	if json.Unmarshal(saved, &old) != nil {
		return nil, errors.New("invalid saved demand scope")
	}
	canonical, _ := json.Marshal(old)
	if string(canonical) != string(raw) {
		return nil, errors.New("demand scope changed; use a new scope ID")
	}
	s.Process = s.decode
	if len(handlers) > 1 {
		return nil, errors.New("invalid event handler count")
	}
	if len(handlers) == 1 {
		if handlers[0] == nil {
			return nil, errors.New("nil event handler")
		}
		s.Process = handlers[0]
	}
	// Startup resumes durable local jobs only. No log/head queries are initiated.
	for i := 0; i < 4; i++ {
		go s.worker()
	}
	s.notify()
	return s, nil
}

func ScopeFromManifest(m deployment.Manifest, start uint64) Scope {
	m.Contracts = append([]deployment.Contract{}, m.Contracts...)
	sort.Slice(m.Contracts, func(i, j int) bool { return m.Contracts[i].Address < m.Contracts[j].Address })
	raw, _ := json.Marshal(m)
	s := Scope{ID: deployment.Hash(raw), ChainID: m.ChainID, Start: start, Modules: map[string]string{}}
	for _, c := range m.Contracts {
		if c.Module != "UniswapV4PoolManager" {
			s.Modules[c.Address] = c.Module
		}
	}
	return s
}
func (s *Service) scope(ctx context.Context, id string) (Scope, error) {
	if id == "" {
		return s.Default, nil
	}
	var raw []byte
	var scope Scope
	if s.Pool.QueryRow(ctx, `SELECT config FROM tickergarden.demand_event_scopes WHERE scope_id=$1 AND chain_id=$2`, id, s.Default.ChainID).Scan(&raw) != nil || json.Unmarshal(raw, &scope) != nil {
		return scope, errors.New("unknown project scope")
	}
	return scope, nil
}
func (s *Service) notify() {
	for i := 0; i < cap(s.wake); i++ {
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}
}

func (s *Service) Load(ctx context.Context, limit int) (eventfeed.Feed, error) {
	return s.LoadScope(ctx, "", limit)
}
func (s *Service) LoadScope(ctx context.Context, id string, limit int) (eventfeed.Feed, error) {
	scope, err := s.scope(ctx, id)
	if err != nil {
		return eventfeed.Feed{}, err
	}
	if limit < 1 || limit > 100 {
		return eventfeed.Feed{}, errors.New("invalid event limit")
	}
	s.mu.Lock()
	if !s.fetching[scope.ID] {
		select {
		case s.slots <- struct{}{}:
			s.fetching[scope.ID] = true
			go func() {
				defer func() { <-s.slots; s.mu.Lock(); delete(s.fetching, scope.ID); s.mu.Unlock() }()
				c, cancel := context.WithTimeout(s.ctx, 30*time.Second)
				defer cancel()
				_ = s.Fetch(c, scope)
			}()
		default:
		}
	}
	s.mu.Unlock()
	return s.read(ctx, scope, limit)
}

func (s *Service) target(ctx context.Context) (chainrpc.Header, error) {
	s.headMu.Lock()
	defer s.headMu.Unlock()
	if !s.headAt.IsZero() && time.Since(s.headAt) < 5*time.Second {
		return s.head, nil
	}
	tag := "finalized"
	if s.Default.FromHead {
		tag = "latest"
	}
	h, err := s.Source.Header(ctx, tag)
	if err == nil {
		s.head = h
		s.headAt = time.Now()
	}
	return h, err
}

// Fetch holds a reader-only advisory lease, not a queue/financial lock. RPC
// calls run outside SQL transactions; processors continue while reads wait.
func (s *Service) Fetch(ctx context.Context, scope Scope) error {
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var locked bool
	key := "demand-read:" + scope.ID
	if err = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1,0))`, key).Scan(&locked); err != nil || !locked {
		return err
	}
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = conn.Exec(c, `SELECT pg_advisory_unlock(hashtextextended($1,0))`, key)
	}()
	var cursor uint64
	var observed *time.Time
	var retry bool
	if err = conn.QueryRow(ctx, `SELECT read_through,observed_at,retry_at>clock_timestamp() FROM tickergarden.demand_event_scopes WHERE scope_id=$1`, scope.ID).Scan(&cursor, &observed, &retry); err != nil {
		return err
	}
	if retry || (observed != nil && time.Since(*observed) < s.TTL) {
		return nil
	}
	h, err := s.target(ctx)
	if err != nil {
		return s.failRead(ctx, conn, scope.ID, err)
	}
	end, err := h.Height()
	if err != nil || (end < cursor && !s.Default.FromHead) {
		return errors.New("demand source finality regressed")
	}
	// The head feed starts at the first requested head, never at deployment history.
	// If the previous observation was replaced, reset this display-only window.
	reset := scope.FromHead && observed == nil && cursor == scope.Start-1
	if s.Default.FromHead && observed != nil {
		var previous uint64
		var hash string
		if e := conn.QueryRow(ctx, `SELECT head_number,head_hash FROM tickergarden.demand_event_scopes WHERE scope_id=$1`, scope.ID).Scan(&previous, &hash); e != nil {
			return e
		}
		if end == previous {
			reset = h.Hash != hash
		} else if end == previous+1 && h.ParentHash == hash {
			reset = false
		} else {
			old, e := s.Source.Header(ctx, fmt.Sprintf("0x%x", previous))
			if e != nil {
				return s.failRead(ctx, conn, scope.ID, e)
			}
			reset = old.Hash != hash || end < cursor
		}
	}
	if reset {
		tx, e := conn.Begin(ctx)
		if e != nil {
			return e
		}
		// Same scope processor lease: wait only during a rare branch reset, never normal reads.
		_, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "demand-process:"+scope.ID)
		if e == nil {
			_, e = tx.Exec(ctx, `DELETE FROM tickergarden.demand_event_records WHERE scope_id=$1`, scope.ID)
		}
		if e == nil {
			_, e = tx.Exec(ctx, `DELETE FROM tickergarden.display_snapshots WHERE scope_id=$1`, scope.ID)
		}
		if e == nil {
			_, e = tx.Exec(ctx, `DELETE FROM tickergarden.demand_event_jobs WHERE scope_id=$1`, scope.ID)
		}
		if e == nil {
			_, e = tx.Exec(ctx, `DELETE FROM tickergarden.demand_event_ranges WHERE scope_id=$1`, scope.ID)
		}
		if e == nil {
			_, e = tx.Exec(ctx, `UPDATE tickergarden.demand_event_scopes SET start_block=$2,read_through=$2::bigint-1,processed_through=$2::bigint-1,observed_at=NULL WHERE scope_id=$1`, scope.ID, end)
		}
		if e != nil {
			tx.Rollback(context.Background())
			return e
		}
		if e = tx.Commit(ctx); e != nil {
			return e
		}
		cursor = end - 1
	}
	timestamp, err := h.Time()
	if err != nil {
		return err
	}
	addresses := []string{}
	topicSet := map[string]bool{}
	for a, m := range scope.Modules {
		addresses = append(addresses, a)
		for _, t := range events.Topics(m) {
			topicSet[t] = true
		}
	}
	topics := []string{}
	for t := range topicSet {
		topics = append(topics, t)
	}
	sort.Strings(addresses)
	sort.Strings(topics)
	for cursor < end {
		to := min(cursor+512, end)
		logs, e := s.Source.ProjectLogs(ctx, addresses, topics, cursor+1, to)
		if e != nil {
			return s.failRead(ctx, conn, scope.ID, e)
		}
		tx, e := conn.Begin(ctx)
		if e != nil {
			return e
		}
		raw, _ := json.Marshal(logs)
		_, e = tx.Exec(ctx, `INSERT INTO tickergarden.demand_event_ranges(scope_id,from_block,to_block,event_count) VALUES($1,$2,$3,$4)`, scope.ID, cursor+1, to, len(logs))
		if e == nil && len(logs) > 0 {
			_, e = tx.Exec(ctx, `INSERT INTO tickergarden.demand_event_jobs(scope_id,from_block,logs) VALUES($1,$2,$3)`, scope.ID, cursor+1, raw)
		}
		if e == nil {
			_, e = tx.Exec(ctx, `UPDATE tickergarden.demand_event_scopes SET read_through=$2 WHERE scope_id=$1`, scope.ID, to)
		}
		if e == nil {
			e = advance(ctx, tx, scope.ID)
		}
		if e != nil {
			tx.Rollback(context.Background())
			return e
		}
		if e = tx.Commit(ctx); e != nil {
			return e
		}
		cursor = to
		if len(logs) > 0 {
			s.notify()
		}
	}
	_, err = conn.Exec(ctx, `UPDATE tickergarden.demand_event_scopes SET head_number=$2,head_hash=$3,head_timestamp=$4,observed_at=clock_timestamp(),retry_at='-infinity' WHERE scope_id=$1`, scope.ID, end, h.Hash, timestamp)
	return err
}
func (s *Service) failRead(ctx context.Context, conn *pgxpool.Conn, id string, err error) error {
	_, _ = conn.Exec(ctx, `UPDATE tickergarden.demand_event_scopes SET retry_at=clock_timestamp()+interval '5 seconds' WHERE scope_id=$1`, id)
	return err
}
func advance(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := tx.Exec(ctx, `UPDATE tickergarden.demand_event_scopes s SET processed_through=LEAST(s.read_through,COALESCE((SELECT min(from_block)-1 FROM tickergarden.demand_event_jobs j WHERE j.scope_id=s.scope_id AND j.state<>'done'),s.read_through)) WHERE s.scope_id=$1`, id)
	return err
}
