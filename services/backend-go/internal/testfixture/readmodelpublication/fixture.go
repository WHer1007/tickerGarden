// Package readmodelpublication contains small, deterministic fixtures for
// publication integration tests. It deliberately reads the projection golden
// log rather than inventing ABI-shaped events in each test.
package readmodelpublication

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
	"tickergarden/backend/internal/readmodel"
)

type Fixture struct {
	ChainID              uint64
	BlockNumber          string
	BlockHash            string
	TransactionHash      string
	AssetUID             string
	QuoteConfigID        string
	QuoteAsset           string
	BaselineID           string
	TemplateID           string
	MarketID             string
	PoolID               string
	MemeToken            string
	Curve                string
	Gauge                string
	EventNames           []string
	Inputs               []projection.Input
	Batch                deployment.ObservationBatch
	RawInputs            []projection.Input
	FullObservationBatch deployment.ObservationBatch
	Sources              map[string]readmodel.SourceBlock
}

type goldenEntry struct {
	Name  string           `json:"name"`
	Input projection.Input `json:"input"`
}

func Load() (Fixture, error) {
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		return Fixture{}, errors.New("cannot locate readmodel publication fixture")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(source), "../../projection/testdata/golden.json"))
	if err != nil {
		return Fixture{}, err
	}
	var entries []goldenEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return Fixture{}, err
	}
	marketEntry, err := findObservation(entries, "MarketCreated", "market")
	if err != nil {
		return Fixture{}, err
	}
	marketID, assetUID, memeToken, curve, gauge, quoteAsset, baselineID, quoteConfigID, templateID, err := marketIDs(marketEntry.Input)
	if err != nil {
		return Fixture{}, err
	}
	poolID, err := observationKey(marketEntry.Input, "poolKey")
	if err != nil {
		return Fixture{}, err
	}

	assetEntry, err := findObservation(entries, "AssetRegistered", "asset", assetUID)
	if err != nil {
		return Fixture{}, err
	}
	baselineEntry, err := findObservation(entries, "TickerGardenBaselineAdded", "baseline", baselineID)
	if err != nil {
		return Fixture{}, err
	}
	templateEntry, err := findObservation(entries, "LaunchTemplateAdded", "template")
	if err != nil {
		return Fixture{}, err
	}
	templateID, err = observationKey(templateEntry.Input, "template")
	if err != nil {
		return Fixture{}, err
	}
	quoteEntry, err := findTopic(entries, "QuoteAssetConfigAdded", 1, quoteConfigID)
	if err != nil {
		return Fixture{}, err
	}
	feeEntry, err := findTopic(entries, "FeeBucketsCredited", 1, marketID)
	if err != nil {
		return Fixture{}, err
	}

	selected := []goldenEntry{assetEntry, quoteEntry, baselineEntry, templateEntry, marketEntry, feeEntry}
	inputs := make([]projection.Input, 0, len(selected))
	names := make([]string, 0, len(selected))
	observations := make([]deployment.StateObservation, 0)
	for _, entry := range selected {
		inputs = append(inputs, entry.Input)
		names = append(names, entry.Name)
		for _, observation := range entry.Input.Observations {
			observations = append(observations, deployment.StateObservation{Kind: observation.Kind, Key: observation.Key, Value: map[string]any(observation.Value)})
		}
	}
	if len(inputs) != 6 || len(observations) < 5 {
		return Fixture{}, errors.New("single-market publication fixture is incomplete")
	}
	first := inputs[0].Log
	for _, input := range inputs {
		if input.ChainID != firstChain(inputs) || input.Log.BlockNumber != first.BlockNumber || input.Log.BlockHash != first.BlockHash || input.Log.TransactionHash != first.TransactionHash || input.Log.Removed {
			return Fixture{}, errors.New("golden publication inputs are not one canonical transaction")
		}
	}
	batch := deployment.ObservationBatch{Scope: deployment.ObservationScope, ChainID: inputs[0].ChainID, BlockNumber: first.BlockNumber, BlockHash: first.BlockHash, Expected: len(observations), Observations: observations}
	full, sources, err := buildFullCandidateBatch(inputs[0], assetUID, memeToken, curve, gauge, quoteAsset, quoteConfigID, baselineID, templateID, marketID)
	if err != nil {
		return Fixture{}, err
	}
	return Fixture{ChainID: inputs[0].ChainID, BlockNumber: first.BlockNumber, BlockHash: first.BlockHash, TransactionHash: first.TransactionHash, AssetUID: assetUID, QuoteConfigID: quoteConfigID, QuoteAsset: quoteAsset, BaselineID: baselineID, TemplateID: templateID, MarketID: marketID, PoolID: poolID, MemeToken: memeToken, Curve: curve, Gauge: gauge, EventNames: names, Inputs: inputs, Batch: batch, RawInputs: inputs, FullObservationBatch: full, Sources: sources}, nil
}

func buildFullCandidateBatch(input projection.Input, assetUID, memeToken, curve, gauge, quote, quoteID, baseline, template, market string) (deployment.ObservationBatch, map[string]readmodel.SourceBlock, error) {
	block, err := strconv.ParseUint(input.Log.BlockNumber, 0, 64)
	if err != nil {
		return deployment.ObservationBatch{}, nil, err
	}
	index, err := strconv.ParseUint(input.Log.LogIndex, 0, 64)
	if err != nil {
		return deployment.ObservationBatch{}, nil, err
	}
	source := readmodel.SourceBlock{ChainID: input.ChainID, BlockNumber: strconv.FormatUint(block, 10), BlockHash: input.Log.BlockHash, TransactionHash: input.Log.TransactionHash, TransactionIndex: 0, LogIndex: index}
	vault := "0x0000000000000000000000000000000000000008"
	stock := map[string]any{"status": "1", "stockToken": memeToken, "userStockVault": vault, "tokenDecimals": "18", "minimumAllocation": "414"}
	rows := []deployment.StateObservation{
		{Kind: "market", Key: market, Value: map[string]any{"creatorFeesToHolders": false, "assetUid": assetUID, "memeToken": memeToken, "curve": curve, "gauge": gauge, "quoteAsset": quote, "quoteAssetConfigId": quoteID, "tickerGardenBaselineId": baseline, "sourceVersion": "1", "launchPhase": "0", "creatorTaxBps": "0", "graduatedHook": vault, "feePolicyId": template, "executionSpecId": template, "expectedEconomics": template, "launchConfigId": "1", "creatorRevenueBeneficiaryAtCreation": vault, "launchTemplateId": template, "poolId": "0x" + strings.Repeat("0", 64), "stakingEnabled": true}},
		{Kind: "curve", Key: curve, Value: map[string]any{"marketId": market, "quoteAsset": quote, "creatorTaxBps": "0", "realQuoteReserve": "0", "sellableTokens": "0", "reservedTokens": "0", "accruedCurveFees": "0", "readyToGraduate": false}},
		{Kind: "canonicalRoute", Key: market, Value: map[string]any{"swapRouter": vault, "quoter": vault, "hook": vault, "launchLocker": vault, "graduationExecutor": vault, "curveTradingEnabled": true, "poolTradingEnabled": false, "memeToken": memeToken, "quoteAsset": quote, "curve": curve, "gauge": gauge, "sourceVersion": "1", "launchPhase": "0"}},
		{Kind: "poolKey", Key: market, Value: map[string]any{}},
		{Kind: "routeRuntime", Key: market, Value: map[string]any{"swapRouter": template, "quoter": template, "graduationExecutor": template}},
		{Kind: "asset", Key: assetUID, Value: map[string]any{"asset": stock, "fingerprint": map[string]any{"tokenRuntimeCodeHash": template, "beacon": vault, "beaconRuntimeCodeHash": template, "implementation": vault, "implementationRuntimeCodeHash": template}, "vaultRuntimeCodeHash": template}},
		{Kind: "quote", Key: quoteID, Value: map[string]any{"status": "1", "quoteAsset": quote, "tickerGardenBaselineId": baseline, "quoteDecimals": "18", "phantomQuote": "0", "graduationThreshold": "1", "economicsHash": template, "runtimeCodeHash": template, "identityCurrent": true, "stockQuoteBinding": map[string]any{"assetUid": assetUID, "stockTokenFingerprintHash": template, "referenceEvidenceHash": template, "generatorPolicyId": template}}},
		{Kind: "baseline", Key: baseline, Value: map[string]any{"status": "1", "referenceChainId": "46630", "referenceFactory": vault, "referenceFactoryCodeHash": template, "launchConfigId": "1", "supply": "1000000000000000000000000000", "curveFeeBps": "100", "poolFee": "3000", "tickSpacing": "60", "behaviorVectorRoot": template}},
		{Kind: "template", Key: template, Value: map[string]any{"status": "1", "memeTokenImplementation": vault, "memeTokenCodeHash": template, "curveImplementation": vault, "curveCodeHash": template, "gaugeImplementation": vault, "gaugeCodeHash": template, "graduatedHook": vault, "hookCodeHash": template, "graduationExecutor": vault, "graduationExecutorCodeHash": template, "feePolicyId": template, "executionSpecId": template, "templateHash": template, "componentCodeIdentityCurrent": false}},
		{Kind: "vaultSolvency", Key: assetUID, Value: map[string]any{"assetUid": assetUID, "vault": vault, "stockToken": memeToken, "totalDeposited": "0", "totalAllocated": "0", "tokenBalance": "0"}},
		{Kind: "creatorEpoch", Key: market + ":1", Value: map[string]any{"marketId": market, "epoch": "1", "beneficiary": vault, "quoteAsset": quote, "memeAsset": memeToken, "quoteLiability": "1", "memeLiability": "0", "rawRewardExitAt": "100", "observedAtTimestamp": "100", "rawRewardExitReady": true}},
	}
	for _, asset := range []string{quote, memeToken} {
		creator := "0"
		if asset == quote {
			creator = "1"
		}
		rows = append(rows, deployment.StateObservation{Kind: "feeLiability", Key: market + ":" + asset, Value: map[string]any{"marketId": market, "feeAsset": asset, "feeVault": vault, "creator": creator, "creatorEpochCount": "1", "staker": "0", "platform": "0", "holder": "0", "forfeitureReserve": "0", "bucketAndReserveTotal": creator}})
		rows = append(rows, deployment.StateObservation{Kind: "feeSolvency", Key: asset, Value: map[string]any{"feeAsset": asset, "feeVault": vault, "balance": creator, "totalLiability": creator, "knownMarketLiabilitySum": creator}})
	}
	batch := deployment.ObservationBatch{Scope: deployment.ObservationScope, ChainID: input.ChainID, BlockNumber: input.Log.BlockNumber, BlockHash: input.Log.BlockHash, Expected: len(rows), Observations: rows}
	sources := map[string]readmodel.SourceBlock{}
	for _, row := range rows {
		switch row.Kind {
		case "market":
			sources["market:"+row.Key] = source
		case "asset", "quote", "baseline", "template":
			sources["config:"+row.Kind+":"+row.Key] = source
		case "vaultPosition":
			sources["account:"+row.Key] = source
		case "gaugePosition":
			sources["position:"+row.Key] = source
		}
	}
	return batch, sources, nil
}

func firstChain(inputs []projection.Input) uint64 { return inputs[0].ChainID }

func observationKey(input projection.Input, kind string) (string, error) {
	for _, observation := range input.Observations {
		if observation.Kind == kind {
			return observation.Key, nil
		}
	}
	return "", fmt.Errorf("MarketCreated missing %s observation", kind)
}

func marketIDs(input projection.Input) (string, string, string, string, string, string, string, string, string, error) {
	if len(input.Log.Topics) < 3 || len(input.Log.Data) != 2+64*6 {
		return "", "", "", "", "", "", "", "", "", errors.New("MarketCreated ABI payload incomplete")
	}
	word := func(i int) string { return input.Log.Data[2+i*64 : 2+(i+1)*64] }
	address := func(w string) string { return "0x" + w[24:] }
	if len(input.Log.Topics) < 4 {
		return "", "", "", "", "", "", "", "", "", errors.New("MarketCreated meme token topic missing")
	}
	return input.Log.Topics[1], input.Log.Topics[2], "0x" + input.Log.Topics[3][26:], address(word(0)), address(word(1)), address(word(2)), "0x" + word(3), "0x" + word(4), "0x" + word(5), nil
}

func findObservation(entries []goldenEntry, name, kind string, key ...string) (goldenEntry, error) {
	for i := len(entries) - 1; i >= 0; i-- {
		if entries[i].Name != name {
			continue
		}
		for _, observation := range entries[i].Input.Observations {
			if observation.Kind == kind && (len(key) == 0 || observation.Key == key[0]) {
				return entries[i], nil
			}
		}
	}
	return goldenEntry{}, fmt.Errorf("golden event %s/%s not found", name, kind)
}

func findTopic(entries []goldenEntry, name string, index int, want string) (goldenEntry, error) {
	for i := len(entries) - 1; i >= 0; i-- {
		if entries[i].Name == name && len(entries[i].Input.Log.Topics) > index && entries[i].Input.Log.Topics[index] == want {
			return entries[i], nil
		}
	}
	return goldenEntry{}, fmt.Errorf("golden event %s topic %d not found", name, index)
}
