package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/settlement"
	"time"
)

func checkHistory(path string, out io.Writer) error {
	var input struct {
		ChainID     uint64 `json:"chainId"`
		GenesisHash string `json:"genesisHash"`
		MarketID    string `json:"marketId"`
		After       int64  `json:"after"`
	}
	if err := readStrict(path, &input); err != nil {
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
	records, err := (settlement.Store{Pool: pool, ChainID: input.ChainID}).History(ctx, input.GenesisHash, input.MarketID, input.After)
	if err != nil {
		return err
	}
	next := input.After
	if len(records) > 0 {
		next = records[len(records)-1].Sequence
	}
	return json.NewEncoder(out).Encode(map[string]any{"records": records, "nextAfter": next, "auditOnly": true, "transactionSubmission": false})
}
