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
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"service": "activity-worker", "implemented": true, "stage": "finalized-user-activity", "businessFactProjectionImplemented": true, "blockObservationScope": deployment.HolderObservationScope, "activityBackfillImplemented": true, "financialReconciliation": false, "publicationEligible": false, "automaticReconciliationImplemented": false, "transactionSubmission": false})
	}
	if len(os.Args) != 2 || (os.Args[1] != "--once" && os.Args[1] != "--run") {
		return errors.New("usage: activity-worker --describe | --once | --run")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	// Keep discovery writes separate from the API database credentials.
	dsn := os.Getenv("TG_ACTIVITY_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_ACTIVITY_DATABASE_URL is required")
	}
	start, err := strconv.ParseUint(os.Getenv("TG_ACTIVITY_START_BLOCK"), 10, 63)
	if err != nil {
		return errors.New("TG_ACTIVITY_START_BLOCK is required and must be a nonnegative integer")
	}
	endpoint := os.Getenv("TG_ACTIVITY_RPC_URL")
	if endpoint == "" {
		endpoint = os.Getenv("TG_RPC_URL")
	}
	rpc, err := chainrpc.New(endpoint)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := postgres.Open(ctx, dsn, 2)
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
	worker := projector.Worker{Pool: pool, RPC: rpc, Manifest: manifest, StartBlock: start, EventsOnly: false}
	for {
		stepCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		var result projector.Result
		var err error
		result, err = worker.BackfillActivity(stepCtx)
		cancel()
		if ctx.Err() != nil {
			return nil
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
		if result.Action == "idle" || result.Action == "busy" || result.Action == "waiting_for_discovery" {
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
