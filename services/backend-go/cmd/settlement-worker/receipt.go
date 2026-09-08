package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/settlement"
	"time"
)

func receiptCommand(path string, observe bool, out io.Writer) error {
	var input struct {
		settlement.WorkScope
		JobKey string `json:"jobKey"`
		After  int64  `json:"after,omitempty"`
	}
	if err := readStrict(path, &input); err != nil {
		return err
	}
	if input.After < 0 || (observe && input.After != 0) {
		return errors.New("invalid receipt cursor")
	}
	dsn := os.Getenv("TG_SETTLEMENT_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_SETTLEMENT_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 2)
	if err != nil {
		return errors.New("settlement database unavailable")
	}
	defer pool.Close()
	store := settlement.Store{Pool: pool, ChainID: input.ChainID}
	if observe {
		rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if e != nil {
			return e
		}
		record, e := store.ObserveReceipt(ctx, rpc, input.WorkScope, input.JobKey)
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"record": record, "executionComplete": false, "transactionSubmission": false, "refundsVerified": false})
	}
	records, err := store.ReceiptHistory(ctx, input.WorkScope, input.JobKey, input.After)
	if err != nil {
		return err
	}
	after := input.After
	if len(records) > 0 {
		after = records[len(records)-1].Sequence
	}
	return json.NewEncoder(out).Encode(map[string]any{"records": records, "nextAfter": after, "historical": true, "executionComplete": false, "transactionSubmission": false, "refundsVerified": false})
}

func receiptEventsCommand(path string, out io.Writer) error {
	var input struct {
		settlement.WorkScope
		JobKey          string `json:"jobKey"`
		ReceiptSequence int64  `json:"receiptSequence"`
	}
	if err := readStrict(path, &input); err != nil {
		return err
	}
	if input.ReceiptSequence <= 0 {
		return errors.New("receiptSequence is required")
	}
	dsn := os.Getenv("TG_SETTLEMENT_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_SETTLEMENT_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 2)
	if err != nil {
		return errors.New("settlement database unavailable")
	}
	defer pool.Close()
	result, err := (settlement.Store{Pool: pool, ChainID: input.ChainID}).ReceiptEvents(ctx, input.WorkScope, input.JobKey, input.ReceiptSequence)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(map[string]any{"match": result, "historical": true, "intentEventsMatched": true, "refundsVerified": false, "executionComplete": false, "transactionSubmission": false})
}

func receiptTraceCommand(path string, out io.Writer, mode string) error {
	var input struct {
		settlement.WorkScope
		JobKey string `json:"jobKey"`
	}
	if err := readStrict(path, &input); err != nil {
		return err
	}
	dsn := os.Getenv("TG_SETTLEMENT_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_SETTLEMENT_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 2)
	if err != nil {
		return errors.New("settlement database unavailable")
	}
	defer pool.Close()
	rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if err != nil {
		return err
	}
	if mode == "gauge-storage" {
		result, err := (settlement.Store{Pool: pool, ChainID: input.ChainID}).TraceGaugeStorage(ctx, rpc, input.WorkScope, input.JobKey)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"result": result, "refundsVerified": false, "executionComplete": false, "transactionSubmission": false})
	}
	if mode == "liabilities" {
		result, err := (settlement.Store{Pool: pool, ChainID: input.ChainID}).TraceLiabilityStorage(ctx, rpc, input.WorkScope, input.JobKey)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"result": result, "refundsVerified": false, "executionComplete": false, "transactionSubmission": false})
	}
	if mode == "creator-storage" {
		result, err := (settlement.Store{Pool: pool, ChainID: input.ChainID}).TraceCreatorStorage(ctx, rpc, input.WorkScope, input.JobKey)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"result": result, "refundsVerified": false, "executionComplete": false, "transactionSubmission": false})
	}
	if mode == "accounting" {
		result, err := (settlement.Store{Pool: pool, ChainID: input.ChainID}).TraceAccounting(ctx, rpc, input.WorkScope, input.JobKey)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"result": result, "callAccountingMatched": true, "refundsVerified": false, "executionComplete": false, "transactionSubmission": false})
	}
	result, err := (settlement.Store{Pool: pool, ChainID: input.ChainID}).TraceReceipt(ctx, rpc, input.WorkScope, input.JobKey)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(map[string]any{"evidence": result, "traceRootMatched": true, "refundsVerified": false, "executionComplete": false, "transactionSubmission": false})
}
