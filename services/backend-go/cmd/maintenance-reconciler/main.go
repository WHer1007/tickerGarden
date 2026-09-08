package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/maintenance"
	"tickergarden/backend/internal/postgres"
)

func main() {
	if e := run(os.Args[1:], os.Stdout); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run(args []string, out io.Writer) error {
	if len(args) != 1 {
		return errors.New("usage: maintenance-reconciler --describe | --once | --run")
	}
	if args[0] == "--describe" {
		return json.NewEncoder(out).Encode(map[string]any{"service": "maintenance-reconciler", "implemented": true, "durableScheduling": true, "transactionSubmission": false, "signerConfigured": false, "gasObservation": true, "budgetRelease": false})
	}
	if args[0] != "--once" && args[0] != "--run" {
		return errors.New("usage: maintenance-reconciler --describe | --once | --run")
	}
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
	}
	interval := 5 * time.Second
	if value := os.Getenv("TG_MAINTENANCE_POLL_INTERVAL"); value != "" {
		interval, e = time.ParseDuration(value)
		if e != nil || interval < time.Second || interval > time.Minute {
			return errors.New("maintenance poll interval must be 1s..1m")
		}
	}
	file, e := os.Open(os.Getenv("TG_DEPLOYMENT_MANIFEST"))
	if e != nil {
		return errors.New("cannot open TG_DEPLOYMENT_MANIFEST")
	}
	defer file.Close()
	raw, e := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if e != nil {
		return errors.New("cannot read maintenance manifest")
	}
	manifest, e := deployment.Parse(raw)
	if e != nil {
		return e
	}
	if manifest.ChainID != cfg.ChainID {
		return errors.New("manifest and configured chain differ")
	}
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		return e
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, e := postgres.Open(ctx, dsn, cfg.DBMaxConns)
	if e != nil {
		return errors.New("cannot configure maintenance database")
	}
	defer pool.Close()
	worker := maintenance.Reconciler{Store: maintenance.Store{Pool: pool, ChainID: cfg.ChainID}, RPC: rpc, Manifest: manifest}
	for {
		stepCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		result, e := worker.Step(stepCtx)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if e != nil {
			if args[0] == "--once" {
				return e
			}
			if err := json.NewEncoder(out).Encode(map[string]any{"action": "unavailable", "transactionSubmission": false}); err != nil {
				return err
			}
		} else {
			if err := json.NewEncoder(out).Encode(result); err != nil {
				return err
			}
			if args[0] == "--once" {
				if result.Status == "unavailable" || result.GasStatus == "unavailable" {
					return errors.New("maintenance task unavailable; retry scheduled")
				}
				return nil
			}
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}
