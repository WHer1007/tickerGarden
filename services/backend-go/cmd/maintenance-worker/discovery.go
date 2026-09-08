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

func runDiscovery(out io.Writer, path, from string, request deployment.MaintenanceRequest) error {
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	file, e := os.Open(path)
	if e != nil {
		return errors.New("cannot open maintenance manifest")
	}
	defer file.Close()
	raw, e := io.ReadAll(io.LimitReader(file, (1<<20)+1))
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
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 4)
	if e != nil {
		return e
	}
	defer pool.Close()
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		return e
	}
	result, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).DiscoverWork(ctx, rpc, manifest, from, request)
	if e != nil {
		return e
	}
	return json.NewEncoder(out).Encode(map[string]any{"discovery": result, "transactionSubmission": false, "executionComplete": false})
}
