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
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/maintenance"
	"tickergarden/backend/internal/postgres"
)

func runSubmission(out io.Writer, key, manifestPath, hash, owner, token string, generation int64, from string, request deployment.MaintenanceRequest, recovery bool, attempt string) error {
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
	if key != "" {
		if recovery {
			result, e := store.RebroadcastAttempt(ctx, key, attempt)
			if e != nil {
				return e
			}
			return json.NewEncoder(out).Encode(map[string]any{"attempt": result, "executionComplete": false})
		}
		result, e := store.Submission(ctx, key)
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"submission": result, "executionComplete": false})
	}
	file, e := os.Open(manifestPath)
	if e != nil {
		return errors.New("cannot open maintenance manifest")
	}
	defer file.Close()
	raw, e := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if e != nil {
		return errors.New("cannot read maintenance manifest")
	}
	manifest, e := deployment.Parse(raw)
	if e != nil {
		return e
	}
	if manifest.ChainID != cfg.ChainID {
		return errors.New("maintenance manifest and configured chain differ")
	}
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		return e
	}
	block, e := rpc.Header(ctx, "latest")
	if e != nil {
		return e
	}
	p, e := deployment.PreviewMaintenance(ctx, rpc, manifest, block, from, request)
	if e != nil {
		return e
	}
	if _, e = store.Record(ctx, p); e != nil {
		return e
	}
	if recovery {
		result, submitErr := store.Rebroadcast(ctx, rpc, p, hash, attempt)
		if submitErr != nil && !errors.Is(submitErr, chainrpc.ErrSubmissionUnknown) {
			return submitErr
		}
		if e = json.NewEncoder(out).Encode(map[string]any{"attempt": result, "executionComplete": false}); e != nil {
			return e
		}
		return submitErr
	}
	result, submitErr := store.Submit(ctx, rpc, p, hash, owner, token, generation)
	if submitErr != nil && !errors.Is(submitErr, chainrpc.ErrSubmissionUnknown) {
		return submitErr
	}
	if e = json.NewEncoder(out).Encode(map[string]any{"submission": result, "executionComplete": false}); e != nil {
		return e
	}
	return submitErr
}
