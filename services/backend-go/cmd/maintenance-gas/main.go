package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/maintenance"
	"tickergarden/backend/internal/postgres"
	"time"
)

func main() {
	if e := run(os.Args[1:], os.Stdout); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run(args []string, out io.Writer) error {
	if len(args) == 1 && args[0] == "--describe" {
		return json.NewEncoder(out).Encode(map[string]any{"service": "maintenance-gas", "implemented": true, "transactionSubmission": false, "budgetRelease": false, "totalNativeFeeKnown": false})
	}
	fs := flag.NewFlagSet("maintenance-gas", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	observe := fs.String("observe", "", "observe finalized gas cost for job")
	history := fs.String("history", "", "read historical observations for job")
	after := fs.Int64("after", 0, "pagination sequence")
	if e := fs.Parse(args); e != nil || fs.NArg() != 0 || (*observe == "") == (*history == "") || *after < 0 {
		return errors.New("usage: maintenance-gas --describe | --observe JOB | --history JOB [--after SEQUENCE]")
	}
	afterSet := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "after" {
			afterSet = true
		}
	})
	if *observe != "" && afterSet {
		return errors.New("after is only valid with history")
	}
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, cfg.DBMaxConns)
	if e != nil {
		return errors.New("cannot configure maintenance database")
	}
	defer pool.Close()
	store := maintenance.Store{Pool: pool, ChainID: cfg.ChainID}
	if *observe != "" {
		rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if e != nil {
			return e
		}
		record, e := store.ObserveGasCost(ctx, rpc, *observe)
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"record": record, "historical": false, "budgetRelease": false, "executionComplete": false})
	}
	records, e := store.GasCostHistory(ctx, *history, *after)
	if e != nil {
		return e
	}
	return json.NewEncoder(out).Encode(map[string]any{"records": records, "historical": true, "budgetRelease": false, "executionComplete": false})
}
