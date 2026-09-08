package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/settlement"
	"time"
)

func signCommand(path, mode string, out io.Writer) error {
	var input struct {
		settlement.WorkScope
		JobKey         string `json:"jobKey"`
		RawTransaction string `json:"rawTransaction,omitempty"`
	}
	if err := readStrict(path, &input); err != nil {
		return err
	}
	if mode != "--import-signed" && input.RawTransaction != "" {
		return errors.New("raw transaction only allowed for recovery import")
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
	var result settlement.SignResult
	switch mode {
	case "--sign":
		signerPath := os.Getenv("TG_SETTLEMENT_SIGNER_COMMAND")
		info, e := os.Stat(signerPath)
		if !filepath.IsAbs(signerPath) || e != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
			return errors.New("an executable absolute TG_SETTLEMENT_SIGNER_COMMAND is required")
		}

		var fees settlement.ExecutionPolicy
		if err := readStrict(os.Getenv("TG_SETTLEMENT_EXECUTION_POLICY"), &fees); err != nil {
			return err
		}
		rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if e != nil {
			return e
		}
		result, err = store.Sign(ctx, rpc, settlement.ExecSigner{Path: signerPath}, input.WorkScope, input.JobKey, fees)
	case "--import-signed":
		if !strings.HasPrefix(input.RawTransaction, "0x") {
			return errors.New("invalid signed transaction")
		}
		raw, e := hex.DecodeString(input.RawTransaction[2:])
		if e != nil {
			return errors.New("invalid signed transaction")
		}
		result, err = store.ImportSigned(ctx, input.WorkScope, input.JobKey, raw)
	default:
		result, err = store.Signed(ctx, input.WorkScope, input.JobKey)
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(map[string]any{"signing": result, "transactionSubmission": false, "executionComplete": false, "auditOnly": true})
}
