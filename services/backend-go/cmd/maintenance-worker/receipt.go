package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/maintenance"
	"tickergarden/backend/internal/postgres"
)

func runReceipt(out io.Writer, observe, history string, after int64) error {
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
	}
	pool, e := postgres.Open(ctx, dsn, 2)
	if e != nil {
		return e
	}
	defer pool.Close()
	store := maintenance.Store{Pool: pool, ChainID: cfg.ChainID}
	if observe != "" {
		rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if e != nil {
			return e
		}
		record, e := store.ObserveReceipt(ctx, rpc, observe)
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"record": record, "executionComplete": false, "postconditionsVerified": false})
	}
	records, e := store.ReceiptHistory(ctx, history, after)
	if e != nil {
		return e
	}
	return json.NewEncoder(out).Encode(map[string]any{"records": records, "historical": true, "executionComplete": false, "postconditionsVerified": false})
}
