package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/journal"
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
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"service": "indexer", "implemented": true, "stage": "raw-chain-journal", "protocolProjectionImplemented": false, "transactionSubmission": false})
	}
	if len(os.Args) != 2 || (os.Args[1] != "--once" && os.Args[1] != "--run") {
		return errors.New("usage: indexer --describe | --once | --run")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	// Keep journal writes separate from the API's database credentials.
	dsn := os.Getenv("TG_INDEXER_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_INDEXER_DATABASE_URL is required")
	}
	start, err := strconv.ParseUint(os.Getenv("TG_INDEXER_START_BLOCK"), 10, 63)
	if err != nil {
		return errors.New("TG_INDEXER_START_BLOCK is required and must be a nonnegative integer")
	}
	rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := postgres.Open(ctx, dsn, cfg.DBMaxConns)
	if err != nil {
		return errors.New("cannot configure indexer database")
	}
	defer pool.Close()
	worker := journal.Indexer{Pool: pool, RPC: chainrpc.RootVerifiedClient{Client: rpc}, ChainID: cfg.ChainID, StartBlock: start, MaxReorg: 128, RequireReceiptRoot: true}

	if path := os.Getenv("TG_PROJECT_EVENT_SCOPE"); path != "" {
		raw, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		m, e := deployment.Parse(raw)
		if e != nil || m.ChainID != cfg.ChainID {
			return errors.New("invalid project event manifest")
		}
		worker.RPC = chainrpc.NewCachedScopedObserver(rpc, func(ctx context.Context, h chainrpc.Header) ([]string, error) {
			return journal.ProjectEmitters(ctx, pool, m, h)
		})
		worker.AllowEventExclusion = true
	}
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
			return errors.New("cannot write indexer status")
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
