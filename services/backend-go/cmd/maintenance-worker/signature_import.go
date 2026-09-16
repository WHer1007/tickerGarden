package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/maintenance"
	"tickergarden/backend/internal/postgres"
	"time"
)

func runSignatureImport(out io.Writer, path, key, digest, expectedHash, owner, token string, generation int64) error {
	file, e := os.Open(path)
	if e != nil {
		return errors.New("cannot open recovered signature")
	}
	defer file.Close()
	body, e := io.ReadAll(io.LimitReader(file, 32773))
	if e != nil || len(body) > 32772 {
		return errors.New("recovered signature file too large or unreadable")
	}
	value := strings.TrimSpace(string(body))
	if !strings.HasPrefix(value, "0x") {
		return errors.New("recovered signature must be hex")
	}
	raw, e := hex.DecodeString(value[2:])
	if e != nil || len(raw) == 0 || len(raw) > 16384 {
		return errors.New("invalid recovered signature hex")
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
	r, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).ImportSignature(ctx, key, digest, expectedHash, owner, token, generation, raw)
	if e != nil {
		return e
	}
	if e = json.NewEncoder(out).Encode(map[string]any{"signatureImport": r, "transactionSubmission": false, "executionComplete": false}); e != nil {
		return e
	}
	return nil
}
