package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/signal"
	"syscall"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/settlement"
	"time"
)

func enqueueWork(inputPath, manifestPath string, out io.Writer) error {
	var input struct {
		RunID           string                   `json:"runId"`
		DeadlineSeconds int64                    `json:"deadlineSeconds"`
		Selection       settlement.ObservedInput `json:"selection"`
	}
	if err := readStrict(inputPath, &input); err != nil {
		return err
	}
	raw, err := readBounded(manifestPath)
	if err != nil {
		return err
	}
	manifest, err := deployment.Parse(raw)
	if err != nil {
		return err
	}
	var policy settlement.ReferencePolicy
	if err := readStrict(os.Getenv("TG_SETTLEMENT_REFERENCE_POLICY"), &policy); err != nil {
		return err
	}
	dsn := os.Getenv("TG_SETTLEMENT_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_SETTLEMENT_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 2)
	if err != nil {
		return errors.New("settlement database unavailable")
	}
	defer pool.Close()
	work, err := (settlement.Store{Pool: pool, ChainID: manifest.ChainID}).Enqueue(ctx, settlement.WorkSpec{RunID: input.RunID, DeadlineSeconds: input.DeadlineSeconds, Selection: input.Selection, Manifest: manifest, Policy: policy})
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(map[string]any{"work": work, "transactionSubmission": false, "executionComplete": false})
}

func runWork(path string, continuous bool, out io.Writer) error {
	var scope settlement.WorkScope
	if err := readStrict(path, &scope); err != nil {
		return err
	}
	dsn := os.Getenv("TG_SETTLEMENT_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_SETTLEMENT_DATABASE_URL is required")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := postgres.Open(ctx, dsn, 4)
	if err != nil {
		return errors.New("settlement database unavailable")
	}
	defer pool.Close()
	rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if err != nil {
		return err
	}
	worker := settlement.Worker{Store: settlement.Store{Pool: pool, ChainID: scope.ChainID}, RPC: rpc, Scope: scope}
	for {
		tickCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		result, err := worker.Tick(tickCtx)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if err != nil {
			return err
		}
		if err = json.NewEncoder(out).Encode(map[string]any{"work": result, "transactionSubmission": false, "executionComplete": false}); err != nil {
			return err
		}
		if !continuous {
			return nil
		}
		timer := time.NewTimer(5 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}
