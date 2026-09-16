// holder-scope-plan derives continuous Holder seed requests and replay scopes
// from the current candidate without submitting transactions or writing state.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"syscall"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/holderledger"
	"tickergarden/backend/internal/holderplan"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/projector"
	"tickergarden/backend/internal/readmodel"
)

func loadManifest(path string) (deployment.Manifest, string, error) {
	var empty deployment.Manifest
	f, err := os.Open(path)
	if err != nil {
		return empty, "", errors.New("holder scope deployment manifest unavailable")
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return empty, "", errors.New("holder scope deployment manifest exceeds limit")
	}
	manifest, err := deployment.Parse(raw)
	if err != nil {
		return empty, "", errors.New("invalid holder scope deployment manifest")
	}
	sort.Slice(manifest.Contracts, func(i, j int) bool { return manifest.Contracts[i].Address < manifest.Contracts[j].Address })
	canonical, err := json.Marshal(manifest)
	if err != nil {
		return empty, "", errors.New("cannot encode holder scope deployment manifest")
	}
	return manifest, deployment.Hash(canonical), nil
}

func output(plan holderplan.Plan, args []string, out io.Writer) error {
	encoder := json.NewEncoder(out)
	if len(args) == 1 && args[0] == "--scopes" {
		scopes := make([]holderledger.CheckpointScope, 0, len(plan.Items))
		for _, item := range plan.Items {
			scopes = append(scopes, item.Scope)
		}
		return encoder.Encode(scopes)
	}
	if len(args) == 2 && args[0] == "--seed-request" {
		for _, item := range plan.Items {
			if item.MarketID == args[1] {
				return encoder.Encode(item.Seed)
			}
		}
		return errors.New("requested continuous Holder market is absent")
	}
	return encoder.Encode(plan)
}

func run(ctx context.Context, args []string, env func(string) string, out io.Writer) error {
	if len(args) == 1 && args[0] == "--describe" {
		return json.NewEncoder(out).Encode(map[string]any{"service": "holder-scope-plan", "readOnly": true, "writesState": false, "transactionSubmission": false, "outputs": []string{"plan", "scopes", "seed-request"}})
	}
	valid := len(args) == 1 && (args[0] == "--once" || args[0] == "--scopes")
	valid = valid || (len(args) == 2 && args[0] == "--seed-request")
	if !valid {
		return errors.New("usage: holder-scope-plan --describe | --once | --scopes | --seed-request MARKET_ID")
	}
	startRaw := env("TG_PROJECTION_START_BLOCK")
	start, err := strconv.ParseUint(startRaw, 10, 63)
	if err != nil || strconv.FormatUint(start, 10) != startRaw {
		return errors.New("TG_PROJECTION_START_BLOCK must be a canonical nonnegative integer")
	}
	manifest, manifestHash, err := loadManifest(env("TG_DEPLOYMENT_MANIFEST"))
	if err != nil {
		return err
	}
	dsn := env("TG_HOLDER_PLAN_DATABASE_URL")
	if dsn == "" {
		dsn = env("TG_CANDIDATE_DATABASE_URL")
	}
	if dsn == "" {
		return errors.New("TG_HOLDER_PLAN_DATABASE_URL or TG_CANDIDATE_DATABASE_URL is required")
	}
	endpoint := env("TG_HOLDER_PLAN_RPC_URL")
	if endpoint == "" {
		endpoint = env("TG_RPC_URL")
	}
	rpc, err := chainrpc.New(endpoint)
	if err != nil {
		return errors.New("holder scope RPC unavailable")
	}
	limit, err := holderplan.AccountLimit(env("TG_HOLDER_MAX_ACCOUNTS"))
	if err != nil {
		return errors.New("TG_HOLDER_MAX_ACCOUNTS must be a canonical integer from 1 to 10000")
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 2)
	if err != nil {
		return errors.New("holder scope candidate database unavailable")
	}
	defer pool.Close()
	store := readmodel.ObservationStore{EmitterManifest: &manifest, Pool: pool, ChainID: manifest.ChainID, GenesisHash: manifest.GenesisHash, ManifestHash: manifestHash, Version: projector.Version, Scope: projector.ObservationScope, StartBlock: start}
	candidate, err := store.LoadCandidateSet(ctx)
	if err != nil {
		return err
	}
	plan, err := holderplan.Build(ctx, rpc, manifest, candidate, limit)
	if err != nil {
		return err
	}
	return output(plan, args, out)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
