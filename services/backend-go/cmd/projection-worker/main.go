package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/observationwork"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/projector"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) == 2 && os.Args[1] == "--describe" {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"service": "projection-worker", "implemented": true, "stage": "finalized-business-facts", "businessFactProjectionImplemented": true, "blockObservationScope": deployment.HolderObservationScope, "activityBackfillImplemented": true, "automaticReconciliationImplemented": false, "transactionSubmission": false})
	}
	if len(os.Args) != 2 || (os.Args[1] != "--once" && os.Args[1] != "--run" && os.Args[1] != "--backfill-activity-once" && os.Args[1] != "--backfill-activity-run") {
		return errors.New("usage: projection-worker --describe | --once | --run | --backfill-activity-once | --backfill-activity-run")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	// Keep discovery writes separate from the API database credentials.
	dsn := os.Getenv("TG_PROJECTION_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_PROJECTION_DATABASE_URL is required")
	}
	start, err := strconv.ParseUint(os.Getenv("TG_PROJECTION_START_BLOCK"), 10, 63)
	if err != nil {
		return errors.New("TG_PROJECTION_START_BLOCK is required and must be a nonnegative integer")
	}
	endpoint := os.Getenv("TG_PROJECTION_RPC_URL")
	if endpoint == "" {
		endpoint = os.Getenv("TG_RPC_URL")
	}
	pause := time.Duration(0)
	if raw := os.Getenv("TG_PROJECTION_PAUSE_MS"); raw != "" {
		n, e := strconv.ParseUint(raw, 10, 16)
		if e != nil || n > 60000 {
			return errors.New("TG_PROJECTION_PAUSE_MS must be 0..60000")
		}
		pause = time.Duration(n) * time.Millisecond
	}
	rpc, err := chainrpc.New(endpoint)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := postgres.Open(ctx, dsn, cfg.DBMaxConns)
	if err != nil {
		return errors.New("cannot configure projection database")
	}
	defer pool.Close()
	file, err := os.Open(os.Getenv("TG_DEPLOYMENT_MANIFEST"))
	if err != nil {
		return errors.New("cannot open TG_DEPLOYMENT_MANIFEST")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if err != nil {
		return errors.New("cannot read deployment manifest")
	}
	manifest, err := deployment.Parse(data)
	if err != nil {
		return err
	}
	if manifest.ChainID != cfg.ChainID {
		return errors.New("manifest and configured chain differ")
	}
	worker := projector.Worker{Pool: pool, RPC: rpc, Manifest: manifest, StartBlock: start}
	if value := os.Getenv("TG_FINANCIAL_EMPTY_BATCH_SIZE"); value != "" {
		size, err := strconv.ParseUint(value, 10, 16)
		if err != nil || size < 2 || size > 256 {
			return errors.New("TG_FINANCIAL_EMPTY_BATCH_SIZE must be 2..256")
		}
		worker.FinancialEmptyBatchSize = size
	}
	if flag := os.Getenv("TG_SCOPED_OBSERVATIONS"); flag != "" && flag != "0" {
		if flag != "1" {
			return errors.New("TG_SCOPED_OBSERVATIONS must be 0 or 1")
		}
		queuePool, e := postgres.Open(ctx, dsn, 2)
		if e != nil {
			return errors.New("cannot open scoped observation database")
		}
		defer queuePool.Close()
		worker.ObservationQueue = &observationwork.Store{Pool: queuePool}
		if endpoint := os.Getenv("TG_OBSERVATION_RPC_URL"); endpoint != "" {
			worker.ObservationRPC, e = chainrpc.New(endpoint)
			if e != nil {
				return errors.New("invalid observation RPC configuration")
			}
		}
	}

	for {
		stepCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		var result projector.Result
		var err error
		if os.Args[1] == "--backfill-activity-once" || os.Args[1] == "--backfill-activity-run" {
			result, err = worker.BackfillActivity(stepCtx)
		} else {
			result, err = worker.Step(stepCtx)
		}
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if errors.Is(err, observationwork.ErrPending) {
			result.Action = "waiting_for_observations"
			err = nil
		}
		if err != nil {
			return err
		}
		if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
			return errors.New("cannot write projection status")
		}
		if os.Args[1] == "--once" || os.Args[1] == "--backfill-activity-once" || (os.Args[1] == "--backfill-activity-run" && result.Action == "idle") {
			return nil
		}
		if pause > 0 {
			timer := time.NewTimer(pause)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil
			case <-timer.C:
			}
		}
		if result.Action == "waiting_for_observations" || result.Action == "idle" || result.Action == "busy" || result.Action == "waiting_for_discovery" {
			timer := time.NewTimer(3 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil
			case <-timer.C:
			}
		}
	}
}
