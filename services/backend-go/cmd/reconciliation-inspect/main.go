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
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/reconciliation"
	"time"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) == 2 && os.Args[1] == "--describe" {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"service": "reconciliation-inspect", "readOnly": true, "scope": "vault-principal-v3", "verifiesStoredEvidence": true, "verifiesCompleteHistory": false, "transactionSubmission": false})
	}
	if len(os.Args) != 3 {
		return errors.New("usage: reconciliation-inspect --describe | CHAIN_ID BLOCK_HASH")
	}
	chain, e := strconv.ParseUint(os.Args[1], 10, 63)
	if e != nil || strconv.FormatUint(chain, 10) != os.Args[1] {
		return errors.New("invalid chain ID")
	}
	dsn := os.Getenv("TG_RECONCILIATION_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_RECONCILIATION_DATABASE_URL is required")
	}
	signalCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(signalCtx, 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 2)
	if e != nil {
		return errors.New("cannot configure reconciliation database")
	}
	defer pool.Close()
	result, e := reconciliation.Inspect(ctx, pool, chain, os.Args[2])
	if e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}
