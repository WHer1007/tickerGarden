package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func verifyCandidateAssets(ctx context.Context, rpc deployment.BindingObserver, m deployment.Manifest, c readmodel.CandidateSet) error {
	bad := func(stage string) error { return fmt.Errorf("candidate asset RPC verification failed at %s", stage) }
	if e := verifyStaticCandidate(ctx, rpc, m, c); e != nil {
		return bad("static-runtime-start")
	}
	n, e := readmodel.Height(c.BlockNumber)
	if e != nil {
		return bad("candidate-height")
	}
	block, e := rpc.Header(ctx, "0x"+strconv.FormatUint(n, 16))
	if e != nil || block.Hash != c.BlockHash {
		return bad("candidate-header")
	}
	ids := map[string]bool{}
	for _, config := range c.Configs {
		if config.Kind == "asset" {
			if ids[config.ID] {
				return bad("asset-inventory")
			}
			ids[config.ID] = true
		}
	}
	if len(ids) > 4096 {
		return bad("asset-inventory")
	}
	assets, e := deployment.DiscoverAssets(ctx, rpc, m, block, ids)
	if e != nil {
		return bad("asset-discovery")
	}
	if e := matchCandidateAssets(c, assets); e != nil {
		return bad("asset-binding")
	}
	if e := verifyCandidatePrincipalRPC(ctx, rpc, c, assets); e != nil {
		return bad("vault-principal")
	}
	if e := verifyCandidateRoutes(ctx, rpc, m, c); e != nil {
		return bad("market-routes")
	}
	if e := verifyCandidateCurves(ctx, rpc, c); e != nil {
		return bad("curve-progress")
	}
	if e := verifyCandidateConfigs(ctx, rpc, m, c); e != nil {
		return bad("configuration")
	}
	if e := verifyCandidateGauges(ctx, rpc, m, c); e != nil {
		return bad("gauge-positions")
	}
	if e := verifyCandidateFeeLedgerRPC(ctx, rpc, m, c); e != nil {
		return bad("fee-ledger")
	}
	if e := readmodel.VerifyCreatorEpochEvidence(c); e != nil {
		return bad("creator-event-evidence")
	}
	if e := verifyCandidateCreatorEpochs(ctx, rpc, m, c); e != nil {
		return bad("creator-liabilities")
	}
	marketIDs := make([]string, 0, len(c.Markets))
	for _, market := range c.Markets {
		marketIDs = append(marketIDs, market.MarketID)
	}
	historical := []deployment.ServiceAssetTarget{}
	seenServiceAssets := map[string]bool{}
	for _, credit := range c.ServiceCredits {
		key := credit.Distributor + ":" + credit.Asset
		if !seenServiceAssets[key] {
			historical = append(historical, deployment.ServiceAssetTarget{Distributor: credit.Distributor, Asset: credit.Asset})
			seenServiceAssets[key] = true
		}
	}
	holderBatch, e := deployment.ObserveVerifiedKnownHolders(ctx, rpc, m, block, marketIDs, historical...)
	if e != nil || matchCandidateHolders(c, holderBatch) != nil {
		return bad("holder-coverage")
	}
	if readmodel.VerifyHolderEpochRPC(ctx, rpc, m, c) != nil {
		return bad("holder-liabilities")
	}
	if verifyCandidateServiceCredits(ctx, rpc, c) != nil {
		return bad("service-credits")
	}
	// Recheck finality after all dynamic identity and state reads.
	if err := verifyStaticCandidate(ctx, rpc, m, c); err != nil {
		return bad("static-runtime-end")
	}
	return nil
}

func matchCandidateAssets(c readmodel.CandidateSet, assets map[string]deployment.AssetDiscovery) error {
	bad := errors.New("candidate asset identity differs from RPC")
	n, e := readmodel.Height(c.BlockNumber)
	if e != nil {
		return bad
	}
	seen := map[string]bool{}
	for _, config := range c.Configs {
		if config.Kind != "asset" {
			continue
		}
		a, ok := assets[config.ID]
		if !ok || seen[config.ID] || a.AssetUID != config.ID || a.ChainID != c.ChainID || a.BlockHash != c.BlockHash || a.Vault.Module != "UserStockVault" || a.Vault.Address != a.State["userStockVault"] {
			return bad
		}
		seen[config.ID] = true
		batch := deployment.ObservationBatch{ChainID: c.ChainID, BlockNumber: "0x" + strconv.FormatUint(n, 16), BlockHash: c.BlockHash, Expected: 1, Observations: []deployment.StateObservation{{Kind: "asset", Key: config.ID, Value: map[string]any{"asset": a.State, "fingerprint": a.Fingerprint, "vaultRuntimeCodeHash": a.Vault.RuntimeCodeHash}}}}
		expected, e := readmodel.BuildConfigCandidate(batch, "asset", config.ID, config.Source)
		if e != nil || expected.Status != config.Status {
			return bad
		}
		left, e := json.Marshal(expected.Values)
		if e != nil {
			return bad
		}
		right, e := json.Marshal(config.Values)
		if e != nil || !bytes.Equal(left, right) {
			return bad
		}
	}
	if len(seen) != len(assets) {
		return bad
	}
	return nil
}
