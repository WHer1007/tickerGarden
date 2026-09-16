package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/holderledger"
	"tickergarden/backend/internal/holderplan"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/treasury"
)

func loadHolderScopes(path string, required bool) ([]holderledger.CheckpointScope, error) {
	if path == "" {
		if required {
			return nil, errors.New("TG_HOLDER_SCOPE_FILE is required for continuous Holder markets")
		}
		return []holderledger.CheckpointScope{}, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New("cannot open TG_HOLDER_SCOPE_FILE")
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		return nil, errors.New("Holder scope file exceeds limit")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var scopes []holderledger.CheckpointScope
	if decoder.Decode(&scopes) != nil || decoder.Decode(new(any)) != io.EOF || scopes == nil || len(scopes) > 1000 {
		return nil, errors.New("invalid Holder scope file")
	}
	return scopes, nil
}

func verifyAllCandidateRPC(ctx context.Context, rpc *chainrpc.Client, manifest deployment.Manifest, candidate readmodel.CandidateSet) error {
	if verifyHistoryOrigin(ctx, rpc, manifest, candidate) != nil || verifyCandidateAssets(ctx, rpc, manifest, candidate) != nil {
		return errors.New("candidate RPC verification failed")
	}
	if err := verifyCandidateBlockCoverage(ctx, rpc, manifest, candidate); err != nil {
		return err
	}
	return verifyStaticCandidate(ctx, rpc, manifest, candidate)
}

func resolveHolderScopes(ctx context.Context, env func(string) string, rpc holderplan.RPC, manifest deployment.Manifest, candidate readmodel.CandidateSet) ([]holderledger.CheckpointScope, error) {
	continuous := 0
	for _, holder := range candidate.HolderMarkets {
		if holder.Mode == "continuous-24h" {
			continuous++
		}
	}
	scopePath := strings.TrimSpace(env("TG_HOLDER_SCOPE_FILE"))
	var scopes []holderledger.CheckpointScope
	var err error
	if continuous > 0 && scopePath == "" {
		limit, limitErr := holderplan.AccountLimit(env("TG_HOLDER_MAX_ACCOUNTS"))
		if limitErr != nil {
			return nil, errors.New("invalid TG_HOLDER_MAX_ACCOUNTS")
		}
		plan, planErr := holderplan.Build(ctx, rpc, manifest, candidate, limit)
		if planErr != nil {
			return nil, errors.New("automatic Holder scope planning failed")
		}
		scopes = make([]holderledger.CheckpointScope, 0, len(plan.Items))
		for _, item := range plan.Items {
			scopes = append(scopes, item.Scope)
		}
	} else {
		scopes, err = loadHolderScopes(scopePath, continuous > 0)
		if err != nil {
			return nil, err
		}
	}
	if len(scopes) != continuous {
		return nil, errors.New("Holder scope inventory does not match continuous markets")
	}
	return scopes, nil
}

func publishVerifiedCandidate(ctx context.Context, env func(string) string, out io.Writer, candidateStore readmodel.ObservationStore, manifest deployment.Manifest, manifestHash string, candidate readmodel.CandidateSet, primary *chainrpc.Client) error {
	if candidateStore.ManifestHash != manifestHash || candidateStore.ChainID != manifest.ChainID || candidateStore.GenesisHash != manifest.GenesisHash || candidateStore.EmitterManifest == nil {
		return errors.New("candidate store scope differs from publication manifest")
	}
	secondaryURL := strings.TrimSpace(env("TG_CANDIDATE_INDEPENDENT_RPC_URL"))
	primaryURL := strings.TrimSpace(env("TG_CANDIDATE_RPC_URL"))
	if secondaryURL == "" || secondaryURL == primaryURL {
		return errors.New("TG_CANDIDATE_INDEPENDENT_RPC_URL must be a distinct configured endpoint")
	}
	secondary, err := chainrpc.New(secondaryURL)
	if err != nil {
		return errors.New("invalid TG_CANDIDATE_INDEPENDENT_RPC_URL")
	}
	if err = verifyAllCandidateRPC(ctx, secondary, manifest, candidate); err != nil {
		return err
	}
	if err = verifyCandidateTreasuryArtifacts(ctx, treasury.CandidateStore{Pool: candidateStore.Pool}, candidate); err != nil {
		return err
	}
	scopes, err := resolveHolderScopes(ctx, env, primary, manifest, candidate)
	if err != nil {
		return err
	}
	bindings := make([]readmodel.HolderPublicationBinding, 0, len(scopes))
	if len(scopes) > 0 {
		holderDSN := env("TG_HOLDER_REPLAY_DATABASE_URL")
		if holderDSN == "" {
			return errors.New("TG_HOLDER_REPLAY_DATABASE_URL is required")
		}
		holderPool, openErr := postgres.Open(ctx, holderDSN, 2)
		if openErr != nil {
			return errors.New("holder evidence database unavailable")
		}
		defer holderPool.Close()
		store := holderledger.CheckpointStore{Pool: holderPool}
		for _, scope := range scopes {
			audit, ledger, auditErr := store.AuditHistory(ctx, scope)
			if auditErr != nil || ledger == nil {
				return errors.New("Holder history audit failed")
			}
			first, reconcileErr := ledger.Reconcile(ctx, primary, scope.Config, audit.Head)
			if reconcileErr != nil {
				return errors.New("primary Holder reconciliation failed")
			}
			second, reconcileErr := ledger.Reconcile(ctx, secondary, scope.Config, audit.Head)
			if reconcileErr != nil {
				return errors.New("independent Holder reconciliation failed")
			}
			bindings = append(bindings, readmodel.HolderPublicationBinding{Scope: scope, Audit: audit, PrimaryReconciliation: first, IndependentReconciliation: second})
		}
	}
	fresh, err := candidateStore.LoadCandidateSet(ctx)
	before, beforeErr := json.Marshal(candidate)
	after, afterErr := json.Marshal(fresh)
	if err != nil || beforeErr != nil || afterErr != nil || !bytes.Equal(before, after) {
		return errors.New("candidate changed during publication verification")
	}
	height, err := strconv.ParseUint(candidate.BlockNumber, 10, 64)
	if err != nil {
		return errors.New("invalid candidate height")
	}
	head, err := primary.Header(ctx, "0x"+strconv.FormatUint(height, 16))
	if err != nil || head.Hash != candidate.BlockHash {
		return errors.New("candidate changed before assembly")
	}
	secondaryHead, err := secondary.Header(ctx, head.Number)
	if err != nil || secondaryHead != head {
		return errors.New("independent candidate block differs")
	}
	checks := readmodel.PublicationChecks{PrimaryRPCVerified: true, IndependentRPCVerified: true, HistoryOriginVerified: true, CandidateReceiptRootVerified: candidate.HistoryReceiptRootsVerified, CandidateEventCoverageVerified: candidate.HistoryEventCoverageVerified, StaticRuntimeVerified: true, AssetIdentitiesVerified: true, VaultPrincipalVerified: true, MarketRoutesVerified: true, CurveProgressVerified: true, ConfigValuesVerified: true, GaugePositionsVerified: true, FeeLiabilitiesVerified: true, CreatorLiabilitiesVerified: true, HolderLiabilitiesVerified: true, TreasuryArtifactsVerified: true}
	sources := readmodel.PublicationRPCSources{PrimaryEndpointHash: deployment.Hash([]byte(primaryURL)), IndependentEndpointHash: deployment.Hash([]byte(secondaryURL))}
	snapshotRaw, evidenceRaw, err := readmodel.AssemblePublication(candidate, manifestHash, head, sources, checks, bindings)
	if err != nil {
		return err
	}
	publisherDSN := env("TG_PUBLISHER_DATABASE_URL")
	if publisherDSN == "" {
		return errors.New("TG_PUBLISHER_DATABASE_URL is required")
	}
	publisherPool, err := postgres.Open(ctx, publisherDSN, 2)
	if err != nil {
		return errors.New("publisher database unavailable")
	}
	defer publisherPool.Close()
	verifiedAt := time.Now().UTC()
	store := readmodel.Store{Pool: publisherPool, ChainID: candidate.ChainID}
	if err = store.PublishVerified(ctx, snapshotRaw, evidenceRaw, verifiedAt); err != nil {
		return err
	}
	candidateRaw, err := json.Marshal(candidate)
	if err != nil {
		return errors.New("cannot encode published candidate identity")
	}
	return json.NewEncoder(out).Encode(map[string]any{"service": "candidate-inspect", "status": "published", "revision": candidate.BlockNumber + ":" + candidate.BlockHash, "candidateDigest": deployment.Hash(candidateRaw), "publicationEvidenceDigest": deployment.Hash(evidenceRaw), "verifiedAt": verifiedAt.Format(time.RFC3339Nano), "transactionSubmission": false})
}
