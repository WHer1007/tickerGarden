package operations

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/postgres"
)

// Run returns 0 for thresholds satisfied, 2 for recorded attention signals, and
// 1 when the command cannot inspect state. Only complete reports reach stdout.
func Run(ctx context.Context, args []string, getenv func(string) string, out, errOut io.Writer) int {
	fail := func(message string) int { fmt.Fprintln(errOut, message); return 1 }
	if len(args) == 1 && args[0] == "--describe" {
		if json.NewEncoder(out).Encode(map[string]any{"service": "backend-status", "readOnly": true, "finalizedReference": "stored_journal", "optionalRPC": true, "productionReadinessVerified": false}) != nil {
			return 1
		}
		return 0
	}
	prometheus := len(args) == 2 && args[0] == "--once" && args[1] == "--prometheus"
	metricsFile := ""
	if len(args) == 3 && args[0] == "--once" && args[1] == "--metrics-file" {
		metricsFile = args[2]
		if !validMetricsPath(metricsFile) {
			return fail("metrics file must be an absolute .prom path")
		}
	}
	if !prometheus && metricsFile == "" && (len(args) != 1 || args[0] != "--once") {
		return fail("usage: backend-status --describe | --once [--prometheus | --metrics-file /absolute/path.prom]")
	}
	chain := uint64(46630)
	maxLag := uint64(100)
	maxAge := 15 * time.Minute
	for _, option := range []struct {
		name   string
		target *uint64
	}{{"TG_CHAIN_ID", &chain}, {"TG_STATUS_MAX_LAG_BLOCKS", &maxLag}} {
		if raw := getenv(option.name); raw != "" {
			v, e := strconv.ParseUint(raw, 10, 63)
			if e != nil || strconv.FormatUint(v, 10) != raw {
				return fail("invalid " + option.name)
			}
			*option.target = v
		}
	}
	if chain != 4663 && chain != 46630 && chain != 421614 {
		return fail("invalid TG_CHAIN_ID")
	}
	if raw := getenv("TG_STATUS_MAX_PROGRESS_AGE"); raw != "" {
		v, e := time.ParseDuration(raw)
		if e != nil || v <= 0 {
			return fail("invalid TG_STATUS_MAX_PROGRESS_AGE")
		}
		maxAge = v
	}
	dsn := getenv("TG_STATUS_DATABASE_URL")
	if dsn == "" {
		return fail("TG_STATUS_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 2)
	if e != nil {
		return fail("cannot configure status database")
	}
	defer pool.Close()
	report, e := Load(ctx, pool, chain, maxLag, maxAge)
	if e != nil {
		return fail("backend status unavailable")
	}
	if endpoint := getenv("TG_STATUS_RPC_URL"); endpoint != "" {
		rpc, e := chainrpc.New(endpoint)
		if e != nil {
			return fail("invalid status RPC configuration")
		}
		report, e = ObserveRPC(ctx, report, rpc, maxLag)
		if e != nil {
			return fail("backend RPC status unavailable")
		}
	}
	if metricsFile != "" {
		if e := writeMetricsFile(metricsFile, report); e != nil {
			return fail("cannot write backend metrics file")
		}
	} else if prometheus {
		data, e := Metrics(report)
		if e != nil {
			return fail("cannot encode backend metrics")
		}
		if _, e := out.Write(data); e != nil {
			return fail("cannot write backend metrics")
		}
	} else if json.NewEncoder(out).Encode(report) != nil {
		return fail("cannot write backend status")
	}
	if len(report.Alerts) > 0 {
		return 2
	}
	return 0
}
