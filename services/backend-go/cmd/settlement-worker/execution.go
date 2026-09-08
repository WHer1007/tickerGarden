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

type executionEvidenceInput struct {
	settlement.WorkScope
	JobKey   string `json:"jobKey"`
	Sequence int64  `json:"sequence,omitempty"`
	After    int64  `json:"after,omitempty"`
}

func executionEvidenceCommand(path, mode string, out io.Writer) error {
	if mode != "--record-execution-evidence" && mode != "--execution-evidence" && mode != "--execution-evidence-history" {
		return errors.New("invalid execution evidence mode")
	}
	var input executionEvidenceInput
	if err := readStrict(path, &input); err != nil {
		return err
	}
	if input.JobKey == "" {
		return errors.New("jobKey is required")
	}
	if input.Sequence < 0 || input.After < 0 || (mode == "--execution-evidence" && input.Sequence <= 0) || (mode != "--execution-evidence" && input.Sequence != 0) || (mode != "--execution-evidence-history" && input.After != 0) {
		return errors.New("invalid execution evidence cursor")
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
	store := settlement.Store{Pool: pool, ChainID: input.ChainID}
	switch mode {
	case "--record-execution-evidence":
		rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if err != nil {
			return err
		}
		record, err := store.RecordExecutionEvidence(ctx, rpc, input.WorkScope, input.JobKey)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"record": record, "historical": false, "refundsVerified": false, "executionComplete": false})
	case "--execution-evidence":
		record, err := store.ExecutionEvidence(ctx, input.WorkScope, input.JobKey, input.Sequence)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"record": record, "historical": true, "refundsVerified": false, "executionComplete": false})
	default:
		records, err := store.ExecutionEvidenceHistory(ctx, input.WorkScope, input.JobKey, input.After)
		if err != nil {
			return err
		}
		next := input.After
		if len(records) > 0 {
			next = records[len(records)-1].Sequence
		}
		return json.NewEncoder(out).Encode(map[string]any{"records": records, "nextAfter": next, "historical": true, "refundsVerified": false, "executionComplete": false})
	}
}
