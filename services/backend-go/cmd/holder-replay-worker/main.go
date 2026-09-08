package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/holderledger"
	"tickergarden/backend/internal/postgres"
)

func loadScope(path string) (holderledger.CheckpointScope, error) {
	var scope holderledger.CheckpointScope
	f, err := os.Open(path)
	if err != nil {
		return scope, errors.New("holder replay scope unavailable")
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return scope, errors.New("holder replay scope exceeds limit")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if dec.Decode(&scope) != nil || dec.Decode(new(any)) != io.EOF {
		return scope, errors.New("invalid holder replay scope")
	}
	return scope, nil
}

func pauseDuration(raw string) (time.Duration, error) {
	if raw == "" {
		return 3 * time.Second, nil
	}
	n, err := strconv.ParseUint(raw, 10, 16)
	if err != nil || n > 60000 {
		return 0, errors.New("TG_HOLDER_REPLAY_PAUSE_MS must be 0..60000")
	}
	return time.Duration(n) * time.Millisecond, nil
}

func run(ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 1 && args[0] == "--describe" {
		return json.NewEncoder(out).Encode(map[string]any{"service": "holder-replay-worker", "implemented": true, "automaticInitialize": false, "transactionSubmission": false, "historyVerified": false, "publicationEligible": false})
	}
	if len(args) != 2 || (args[0] != "--once" && args[0] != "--run" && args[0] != "--audit") {
		return errors.New("usage: holder-replay-worker --describe | --once SCOPE.json | --run SCOPE.json | --audit SCOPE.json")
	}
	scope, err := loadScope(args[1])
	if err != nil {
		return err
	}
	pause, err := pauseDuration(os.Getenv("TG_HOLDER_REPLAY_PAUSE_MS"))
	if err != nil {
		return err
	}
	dsn := os.Getenv("TG_HOLDER_REPLAY_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_HOLDER_REPLAY_DATABASE_URL is required")
	}
	endpoint := os.Getenv("TG_HOLDER_REPLAY_RPC_URL")
	if endpoint == "" {
		endpoint = os.Getenv("TG_RPC_URL")
	}
	rpc, err := chainrpc.New(endpoint)
	if err != nil {
		return errors.New("holder replay RPC unavailable")
	}
	pool, err := postgres.Open(ctx, dsn, 4)
	if err != nil {
		return errors.New("holder replay database unavailable")
	}
	defer pool.Close()
	store := holderledger.CheckpointStore{Pool: pool}
	verifiedRPC := chainrpc.RootVerifiedClient{Client: rpc}
	if args[0] == "--audit" {
		step, cancel := context.WithTimeout(ctx, 75*time.Second)
		defer cancel()
		audit, ledger, auditErr := store.AuditHistory(step, scope)
		if auditErr != nil {
			return auditErr
		}
		reconciliation, reconcileErr := ledger.Reconcile(step, verifiedRPC, scope.Config, audit.Head)
		if reconcileErr != nil || !reconciliation.FieldsMatched {
			return holderledger.ErrReconciliation
		}
		return json.NewEncoder(out).Encode(map[string]any{"audit": audit, "reconciliation": reconciliation, "historyVerified": false, "publicationEligible": false})
	}
	worker := holderledger.ReplayWorker{Store: store, RPC: verifiedRPC, Scope: scope}
	for {
		step, cancel := context.WithTimeout(ctx, 55*time.Second)
		result, stepErr := worker.Step(step)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if stepErr != nil {
			return stepErr
		}
		if json.NewEncoder(out).Encode(result) != nil {
			return errors.New("cannot write holder replay status")
		}
		if args[0] == "--once" {
			return nil
		}
		wait := pause
		if result.Action == "idle" && wait < 3*time.Second {
			wait = 3 * time.Second
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
