package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/maintenance"
	"tickergarden/backend/internal/postgres"
	"time"
)

func runPoststate(out io.Writer, key, path string) error {
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	f, e := os.Open(path)
	if e != nil {
		return errors.New("cannot open maintenance manifest")
	}
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if e != nil {
		return e
	}
	manifest, e := deployment.Parse(raw)
	if e != nil {
		return e
	}
	dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 2)
	if e != nil {
		return e
	}
	defer pool.Close()
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		return e
	}
	record, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).VerifyPoststate(ctx, rpc, manifest, key)
	if e != nil {
		return e
	}
	return json.NewEncoder(out).Encode(map[string]any{"record": record, "postconditionsVerified": record.Evidence.State.Satisfied, "executionComplete": record.Evidence.State.Satisfied})
}
