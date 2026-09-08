package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/deployment"
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
		return json.NewEncoder(out).Encode(map[string]any{"service": "maintenance-budget", "implemented": true, "transactionSubmission": false, "unit": "native base units", "accounting": "cumulative maximum gas commitments"})
	}
	fs := flag.NewFlagSet("maintenance-budget", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	set := fs.Bool("set", false, "configure limits")
	inspect := fs.Bool("inspect", false, "read current budget")
	manifestPath := fs.String("manifest", "", "deployment manifest")
	from := fs.String("from", "", "maintenance sender")
	max := fs.String("max-transaction", "", "maximum gas commitment per transaction")
	total := fs.String("maximum-total", "", "cumulative maximum gas commitments")
	request := fs.String("request-id", "", "idempotent configuration request ID")
	if e := fs.Parse(args); e != nil || fs.NArg() != 0 || *set == *inspect || *manifestPath == "" || *from == "" || (*set && (*max == "" || *total == "" || *request == "")) || (*inspect && (*max != "" || *total != "" || *request != "")) {
		return errors.New("usage: maintenance-budget --describe | --inspect/--set --manifest FILE --from ADDRESS [--max-transaction WEI --maximum-total WEI --request-id HASH]")
	}
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	dsn := os.Getenv("TG_MAINTENANCE_OPERATOR_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_MAINTENANCE_OPERATOR_DATABASE_URL is required")
	}
	file, e := os.Open(*manifestPath)
	if e != nil {
		return errors.New("cannot open budget manifest")
	}
	defer file.Close()
	raw, e := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if e != nil {
		return errors.New("cannot read budget manifest")
	}
	m, e := deployment.Parse(raw)
	if e != nil {
		return e
	}
	if m.ChainID != cfg.ChainID {
		return errors.New("manifest and configured chain differ")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, cfg.DBMaxConns)
	if e != nil {
		return errors.New("cannot configure maintenance operator database")
	}
	defer pool.Close()
	store := maintenance.Store{Pool: pool, ChainID: cfg.ChainID}
	var result maintenance.GasBudget
	if *set {
		result, e = store.SetGasBudget(ctx, m.GenesisHash, *from, *max, *total, *request)
	} else {
		result, e = store.GasBudget(ctx, m.GenesisHash, *from)
	}
	if e != nil {
		return e
	}
	return json.NewEncoder(out).Encode(map[string]any{"budget": result, "transactionSubmission": false})
}
