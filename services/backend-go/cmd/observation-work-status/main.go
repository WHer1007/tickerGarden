package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"tickergarden/backend/internal/observationwork"
	"tickergarden/backend/internal/postgres"
	"time"
)

func run(ctx context.Context, args []string, env func(string) string, out, errOut io.Writer) int {
	fail := func(s string) int { fmt.Fprintln(errOut, s); return 1 }
	if len(args) == 1 && args[0] == "--describe" {
		if json.NewEncoder(out).Encode(map[string]any{"service": "observation-work-status", "readOnly": true, "scope": "database_all_retained_observation_jobs", "financiallyVerified": false}) != nil {
			return 1
		}
		return 0
	}
	prom := len(args) == 2 && args[0] == "--once" && args[1] == "--prometheus"
	if !prom && (len(args) != 1 || args[0] != "--once") {
		return fail("usage: observation-work-status --describe | --once [--prometheus]")
	}
	age := 120 * time.Second
	if raw := env("TG_OBSERVATION_STATUS_MAX_PENDING_AGE"); raw != "" {
		v, e := time.ParseDuration(raw)
		if e != nil || v <= 0 || v > 24*time.Hour {
			return fail("invalid TG_OBSERVATION_STATUS_MAX_PENDING_AGE")
		}
		age = v
	}
	dsn := env("TG_STATUS_DATABASE_URL")
	if dsn == "" {
		return fail("TG_STATUS_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 1)
	if e != nil {
		return fail("cannot configure observation status database")
	}
	defer pool.Close()
	status, e := observationwork.LoadQueueStatus(ctx, pool, age)
	if e != nil {
		return fail("observation queue status unavailable")
	}
	if prom {
		raw, e := observationwork.QueueMetrics(status)
		if e != nil {
			return fail("cannot encode observation metrics")
		}
		if _, e = out.Write(raw); e != nil {
			return fail("cannot write observation metrics")
		}
	} else if json.NewEncoder(out).Encode(status) != nil {
		return fail("cannot write observation status")
	}
	if len(status.Alerts) > 0 {
		return 2
	}
	return 0
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}
