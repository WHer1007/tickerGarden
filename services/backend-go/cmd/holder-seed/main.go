package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/holderledger"
	"tickergarden/backend/internal/postgres"
)

type request struct {
	Seed        holderledger.SeedConfig `json:"seed"`
	BlockNumber string                  `json:"blockNumber"`
}

func loadRequest(path string) (request, error) {
	var value request
	f, err := os.Open(path)
	if err != nil {
		return value, errors.New("holder seed request unavailable")
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return value, errors.New("holder seed request exceeds limit")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || decoder.Decode(new(any)) != io.EOF {
		return value, errors.New("invalid holder seed request")
	}
	if _, err = chainrpc.Quantity(value.BlockNumber); err != nil || value.BlockNumber == "0x0" {
		return value, errors.New("invalid holder seed block number")
	}
	return value, nil
}

func run(ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 1 && args[0] == "--describe" {
		return json.NewEncoder(out).Encode(map[string]any{"service": "holder-seed", "implemented": true, "requiresFinalizedDeploymentBlock": true, "rootVerifiedReceipts": true, "transactionSubmission": false, "historyVerified": false, "publicationEligible": false})
	}
	if len(args) != 2 || args[0] != "--initialize" {
		return errors.New("usage: holder-seed --describe | --initialize REQUEST.json")
	}
	request, err := loadRequest(args[1])
	if err != nil {
		return err
	}
	dsn := os.Getenv("TG_HOLDER_REPLAY_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_HOLDER_REPLAY_DATABASE_URL is required")
	}
	endpoint := os.Getenv("TG_HOLDER_REPLAY_RPC_URL")
	if endpoint == "" {
		endpoint = os.Getenv("TG_RPC_URL")
	}
	client, err := chainrpc.New(endpoint)
	if err != nil {
		return errors.New("holder seed RPC unavailable")
	}
	pool, err := postgres.Open(ctx, dsn, 4)
	if err != nil {
		return errors.New("holder seed database unavailable")
	}
	defer pool.Close()
	rpc := chainrpc.RootVerifiedClient{Client: client}
	block, err := rpc.Header(ctx, request.BlockNumber)
	if err != nil {
		return holderledger.ErrSeedAuthentication
	}
	step, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	ledger, report, evidence, err := holderledger.AuthenticatePristineSeedWithEvidence(step, rpc, request.Seed, block)
	if err != nil {
		return err
	}
	store := holderledger.CheckpointStore{Pool: pool}
	if err = store.InitializeAuthenticatedEvidence(step, request.Seed.Scope, block, ledger, report, evidence); err != nil {
		stored, current, _, loadErr := store.Load(step, request.Seed.Scope)
		if loadErr != nil || stored.Seed == nil || *stored.Seed != report || stored.Block != block {
			return err
		}
		want, wantErr := holderledger.EncodeCheckpoint(ledger)
		got, gotErr := holderledger.EncodeCheckpoint(current)
		if wantErr != nil || gotErr != nil || !bytes.Equal(want, got) {
			return err
		}
		audit, audited, auditErr := store.AuditHistory(step, request.Seed.Scope)
		if auditErr != nil || audited == nil || audit.Revisions != 1 || audit.Head != block || !audit.RawRootsReverified || !audit.EvidenceReplayValid {
			return err
		}
	}
	return json.NewEncoder(out).Encode(report)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
