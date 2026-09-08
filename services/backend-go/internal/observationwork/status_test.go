package observationwork

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"testing"
	"time"
)

func TestQueueStatusSignals(t *testing.T) {
	now := time.Unix(10000, 0).UTC()
	old := now.Add(-121 * time.Second)
	base := QueueStatus{Scope: "database_all_retained_observation_jobs", ObservedAt: now, Total: 6, Pending: 3, Running: 2, Complete: 1, RetryReady: 2, RetryDeferred: 1, ExpiredLeases: 1, RepeatedFailures: 2, OldestPendingUpdate: &old}
	s, e := EvaluateQueueStatus(base, 120*time.Second)
	if e != nil || strings.Join(s.Alerts, ",") != "pending_stalled,lease_expired,repeated_failure" || s.FinanciallyVerified {
		t.Fatalf("signals: %+v %v", s, e)
	}
	raw, e := QueueMetrics(s)
	if e != nil {
		t.Fatal(e)
	}
	for _, fragment := range []string{"tickergarden_observation_pending_jobs 3\n", "tickergarden_observation_pending_update_age_seconds 121.000\n", "tickergarden_observation_attention 1\n"} {
		if !strings.Contains(string(raw), fragment) {
			t.Fatal("missing", fragment)
		}
	}
	for _, bad := range []string{"0x", "request_key", "chain_id=", "wallet", "provider"} {
		if strings.Contains(string(raw), bad) {
			t.Fatal("private/cardinality label", bad)
		}
	}
	for _, mutate := range []func(*QueueStatus){func(s *QueueStatus) { s.Pending = -1 }, func(s *QueueStatus) { s.Complete = 3 }, func(s *QueueStatus) { s.ExpiredLeases = 3 }, func(s *QueueStatus) { s.OldestPendingUpdate = nil }, func(s *QueueStatus) { s.FinanciallyVerified = true }} {
		bad := base
		mutate(&bad)
		if _, e := EvaluateQueueStatus(bad, time.Minute); e == nil {
			t.Fatal("invalid status accepted")
		}
	}
	future := now.Add(time.Second)
	base.OldestPendingUpdate = &future
	s, e = EvaluateQueueStatus(base, time.Minute)
	if e != nil || s.PendingAgeSeconds != nil || s.Alerts[0] != "future_update" {
		t.Fatal("future timestamp hidden")
	}
	empty, e := EvaluateQueueStatus(QueueStatus{Scope: base.Scope, ObservedAt: now}, time.Minute)
	if e != nil || len(empty.Alerts) != 0 {
		t.Fatal("empty cache should not assert missing financial evidence")
	}
	raw, e = QueueMetrics(empty)
	if e != nil || strings.Contains(string(raw), "pending_update_age_seconds") {
		t.Fatal("missing timestamp replaced with zero")
	}
}
func TestQueueStatusPostgresReadOnlyAndIndependent(t *testing.T) {
	p := queueDB(t)
	ctx := context.Background()
	r := queueRequests(t)[0]
	raw, key, e := r.Encode()
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.Exec(ctx, `INSERT INTO tickergarden.observation_work(request_key,request,attempts,updated_at) VALUES($1,$2,5,now()-interval '3 minutes')`, key, raw); e != nil {
		t.Fatal(e)
	}
	lock, e := p.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer lock.Rollback(ctx)
	if _, e = lock.Exec(ctx, `SELECT pg_advisory_xact_lock(730421614)`); e != nil {
		t.Fatal(e)
	}
	s, e := LoadQueueStatus(ctx, p, time.Minute)
	if e != nil || s.Pending != 1 || s.RepeatedFailures != 1 || s.FinanciallyVerified || len(s.Alerts) != 2 {
		t.Fatalf("status blocked or wrong: %+v %v", s, e)
	}
	var state string
	var attempts int
	var after []byte
	if e = p.QueryRow(ctx, `SELECT state,attempts,request FROM tickergarden.observation_work WHERE request_key=$1`, key).Scan(&state, &attempts, &after); e != nil || state != "pending" || attempts != 5 || string(after) != string(raw) {
		t.Fatal("monitor changed a job")
	}
	if _, e = p.Exec(ctx, `UPDATE tickergarden.observation_work SET state='running',lease_until=now()-interval '1 second' WHERE request_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	s, e = LoadQueueStatus(ctx, p, time.Minute)
	if e != nil || s.ExpiredLeases != 1 || s.PendingAgeSeconds != nil {
		t.Fatal("expired lease not detected", e)
	}
	if _, e = p.Exec(ctx, `UPDATE tickergarden.observation_work SET lease_until=NULL,updated_at=now()+interval '1 minute' WHERE request_key=$1`, key); e != nil {
		t.Fatal(e)
	}
	s, e = LoadQueueStatus(ctx, p, time.Minute)
	if e != nil || s.InvalidRows != 1 {
		t.Fatal("invalid running row hidden", e)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, e = LoadQueueStatus(cancelled, p, time.Minute); e == nil {
		t.Fatal("cancel returned healthy report")
	}
}

func TestQueueStatusMetadataOnlyRole(t *testing.T) {
	p := queueDB(t)
	ctx := context.Background()
	role := pgx.Identifier{fmt.Sprintf("tg_obs_reader_%d", time.Now().UnixNano())}.Sanitize()
	if _, e := p.Exec(ctx, "CREATE ROLE "+role); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		if _, e := p.Exec(ctx, "DROP OWNED BY "+role); e != nil {
			t.Error(e)
		}
		if _, e := p.Exec(ctx, "DROP ROLE "+role); e != nil {
			t.Error(e)
		}
	})
	if _, e := p.Exec(ctx, "GRANT USAGE ON SCHEMA tickergarden TO "+role); e != nil {
		t.Fatal(e)
	}
	if _, e := p.Exec(ctx, "GRANT SELECT(state,attempts,generation,updated_at,retry_after,lease_until) ON tickergarden.observation_work TO "+role); e != nil {
		t.Fatal(e)
	}
	cfg := p.Config().Copy()
	cfg.AfterConnect = func(c context.Context, conn *pgx.Conn) error { _, e := conn.Exec(c, "SET ROLE "+role); return e }
	limited, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(limited.Close)
	s, e := LoadQueueStatus(ctx, limited, time.Minute)
	if e != nil || s.Total != 0 {
		t.Fatal("metadata-only monitor failed", e)
	}
	if _, e = limited.Exec(ctx, `SELECT request FROM tickergarden.observation_work`); e == nil {
		t.Fatal("monitor role can read request")
	}
	if _, e = limited.Exec(ctx, `DELETE FROM tickergarden.observation_work`); e == nil {
		t.Fatal("monitor role can delete jobs")
	}
}
