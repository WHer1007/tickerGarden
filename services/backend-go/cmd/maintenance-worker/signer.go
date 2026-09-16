package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/maintenance"
	"tickergarden/backend/internal/postgres"
	"time"
)

func runSigner(out io.Writer, path, key, digest, owner, token string, generation int64) error {
	if !filepath.IsAbs(path) {
		return errors.New("signer executable must be an absolute path")
	}
	cfg, e := config.Load()
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
		return errors.New("cannot configure signer database")
	}
	defer pool.Close()
	r, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).Sign(ctx, maintenance.ExecSigner{Path: path}, key, digest, owner, token, generation)
	if e != nil {
		return e
	}
	if e = json.NewEncoder(out).Encode(map[string]any{"signing": r, "transactionSubmission": false, "executionComplete": false}); e != nil {
		return e
	}
	if r.Status != "signed_stored" {
		return errors.New("signature not attached; inspect signing result before recovery")
	}
	return nil
}
