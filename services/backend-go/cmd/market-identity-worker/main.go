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
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/marketidentity"
	"tickergarden/backend/internal/postgres"
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
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"service": "market-identity-worker", "implemented": true, "stage": "finalized-market-identity", "protocolProjectionImplemented": false, "transactionSubmission": false})
	}
	if len(os.Args) != 2 || (os.Args[1] != "--once" && os.Args[1] != "--run") {
		return errors.New("usage: market-identity-worker --describe | --once | --run")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	// Keep discovery writes separate from the API database credentials.
	dsn := os.Getenv("TG_MARKET_IDENTITY_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_MARKET_IDENTITY_DATABASE_URL is required")
	}
	rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := postgres.Open(ctx, dsn, cfg.DBMaxConns)
	if err != nil {
		return errors.New("cannot configure discovery database")
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
	worker := marketidentity.Worker{Pool: pool, RPC: rpc, Manifest: manifest}
	for {
		stepCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		result, err := worker.Step(stepCtx)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if err != nil {
			return err
		}
		if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
			return errors.New("cannot write discovery status")
		}
		if os.Args[1] == "--once" {
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
