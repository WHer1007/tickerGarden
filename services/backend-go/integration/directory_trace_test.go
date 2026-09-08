package integration

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type directoryQueryKey struct{}
type directoryQueryStart struct {
	kind string
	at   time.Time
}
type directoryQuerySample struct {
	sql           string
	args          []any
	count, failed int
	total, max    time.Duration
}

// Test-only tracing: no arguments, query text, connection strings or row data
// are logged. Elapsed time includes network transfer and client row consumption.
type directoryQueryTrace struct {
	mu      sync.Mutex
	enabled bool
	samples map[string]directoryQuerySample
}

func (d *directoryQueryTrace) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	kind := ""
	sql := strings.TrimSpace(data.SQL)
	if strings.HasPrefix(sql, "WITH recent AS (") {
		kind = "snapshot"
	}
	if strings.HasPrefix(sql, "SELECT i.market_id,i.payload,i.digest") || strings.HasPrefix(sql, "WITH identity_anchor AS MATERIALIZED (") {
		kind = "identities"
	}
	if kind == "" {
		return ctx
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.enabled {
		return ctx
	}
	sample := d.samples[kind]
	sample.sql = data.SQL
	sample.args = append([]any(nil), data.Args...)
	d.samples[kind] = sample
	return context.WithValue(ctx, directoryQueryKey{}, directoryQueryStart{kind: kind, at: time.Now()})
}
func (d *directoryQueryTrace) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	start, ok := ctx.Value(directoryQueryKey{}).(directoryQueryStart)
	if !ok {
		return
	}
	elapsed := time.Since(start.at)
	d.mu.Lock()
	defer d.mu.Unlock()
	sample := d.samples[start.kind]
	sample.count++
	sample.total += elapsed
	if elapsed > sample.max {
		sample.max = elapsed
	}
	if data.Err != nil {
		sample.failed++
	}
	d.samples[start.kind] = sample
}
func (d *directoryQueryTrace) start() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.samples = map[string]directoryQuerySample{}
	d.enabled = true
}
func (d *directoryQueryTrace) report(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	d.mu.Lock()
	d.enabled = false
	samples := d.samples
	d.mu.Unlock()
	for _, kind := range []string{"snapshot", "identities"} {
		sample := samples[kind]
		if sample.count == 0 {
			t.Fatalf("missing %s query observations", kind)
		}
		t.Logf("directory query=%s calls=%d failures=%d mean=%s max=%s (includes transfer and row consumption)", kind, sample.count, sample.failed, sample.total/time.Duration(sample.count), sample.max)
		explainCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		var raw []byte
		err := pool.QueryRow(explainCtx, "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+sample.sql, sample.args...).Scan(&raw)
		cancel()
		if err != nil {
			t.Fatalf("cannot explain %s directory query: %v", kind, err)
		}
		var plans []struct {
			Planning  float64 `json:"Planning Time"`
			Execution float64 `json:"Execution Time"`
			Plan      struct {
				Rows       float64 `json:"Actual Rows"`
				Hits       float64 `json:"Shared Hit Blocks"`
				Reads      float64 `json:"Shared Read Blocks"`
				TempReads  float64 `json:"Temp Read Blocks"`
				TempWrites float64 `json:"Temp Written Blocks"`
			} `json:"Plan"`
		}
		if err = json.Unmarshal(raw, &plans); err != nil || len(plans) != 1 {
			t.Fatalf("invalid %s query plan: %v", kind, err)
		}
		plan := plans[0]
		t.Logf("directory explain=%s planning_ms=%.3f execution_ms=%.3f rows=%.0f shared_hits=%.0f shared_reads=%.0f temp_reads=%.0f temp_writes=%.0f (server execution only; warm state)", kind, plan.Planning, plan.Execution, plan.Plan.Rows, plan.Plan.Hits, plan.Plan.Reads, plan.Plan.TempReads, plan.Plan.TempWrites)
	}
}
