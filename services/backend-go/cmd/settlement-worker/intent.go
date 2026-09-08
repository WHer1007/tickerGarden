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

func intentCommand(path string, prepare bool, out io.Writer) error {
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
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 2)
	if err != nil {
		return errors.New("settlement database unavailable")
	}
	defer pool.Close()
	store := settlement.Store{Pool: pool, ChainID: input.ChainID}
	var result settlement.IntentRecord
	reused := false
	if prepare {
		var fees settlement.ExecutionPolicy
		if err := readStrict(os.Getenv("TG_SETTLEMENT_EXECUTION_POLICY"), &fees); err != nil {
			return err
		}
		rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if err != nil {
			return err
		}
		result, reused, err = store.PrepareIntent(ctx, rpc, input.WorkScope, input.JobKey, fees)
		if err != nil {
			return err
		}
	} else {
		result, err = store.Intent(ctx, input.WorkScope, input.JobKey)
		if err != nil {
			return err
		}
	}
	return json.NewEncoder(out).Encode(map[string]any{"record": result, "reused": reused, "auditOnly": !prepare || reused, "transactionSubmission": false, "executionComplete": false, "signerConfigured": false})
}
