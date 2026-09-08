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

func submissionCommand(path string, submit bool, out io.Writer) error {
	var input struct {
		settlement.WorkScope
		JobKey                  string `json:"jobKey"`
		ExpectedTransactionHash string `json:"expectedTransactionHash,omitempty"`
	}
	if err := readStrict(path, &input); err != nil {
		return err
	}
	if submit && input.ExpectedTransactionHash == "" {
		return errors.New("expectedTransactionHash is required")
	}
	dsn := os.Getenv("TG_SETTLEMENT_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_SETTLEMENT_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 2)
	if err != nil {
		return errors.New("settlement database unavailable")
	}
	defer pool.Close()
	store := settlement.Store{Pool: pool, ChainID: input.ChainID}
	var result settlement.Submission
	if submit {
		rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if e != nil {
			return e
		}
		result, err = store.Submit(ctx, rpc, input.WorkScope, input.JobKey, input.ExpectedTransactionHash)
	} else {
		result, err = store.Submission(ctx, input.WorkScope, input.JobKey)
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(map[string]any{"submission": result, "executionComplete": false, "auditOnly": !submit})
}
