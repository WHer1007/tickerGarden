package readmodel

import (
	"encoding/json"
	"errors"
	"reflect"
	"strconv"

	"tickergarden/backend/internal/deployment"
)

// BuildMarketCandidate maps one authenticated end-of-block observation batch.
// Source is the market's source event, not transaction-time provenance for these
// end-of-block values. The caller must verify persisted batch/receipt provenance;
// this function neither reconciles balances nor authorizes publication.
func BuildMarketCandidate(batch deployment.ObservationBatch, id string, source SourceBlock) (MarketReadModel, error) {
	fail := func() (MarketReadModel, error) {
		return MarketReadModel{}, errors.New("incomplete or inconsistent market candidate observations")
	}
	if batch.Expected != len(batch.Observations) || len(batch.Observations) > 100000 || batch.ChainID != source.ChainID {
		return fail()
	}
	block, err := strconv.ParseUint(batch.BlockNumber, 0, 64)
	if err != nil || batch.BlockNumber != "0x"+strconv.FormatUint(block, 16) {
		return fail()
	}
	sourceHeight, sourceErr := Height(source.BlockNumber)
	if sourceErr != nil || sourceHeight > block || (sourceHeight == block && source.BlockHash != batch.BlockHash) {
		return fail()
	}
	observations := map[string]map[string]any{}
	for _, o := range batch.Observations {
		key := o.Kind + ":" + o.Key
		if _, exists := observations[key]; exists {
			return fail()
		}
		observations[key] = o.Value
	}
	market := observations["market:"+id]
	curveAddress, ok := market["curve"].(string)
	if !ok {
		return fail()
	}
	curve := observations["curve:"+curveAddress]
	route := observations["canonicalRoute:"+id]
	pool := observations["poolKey:"+id]
	runtime := observations["routeRuntime:"+id]
	if market == nil || curve == nil || route == nil || pool == nil || runtime == nil {
		return fail()
	}
	if !reflect.DeepEqual(curve["marketId"], id) || !reflect.DeepEqual(curve["quoteAsset"], market["quoteAsset"]) || !reflect.DeepEqual(curve["creatorTaxBps"], market["creatorTaxBps"]) {
		return fail()
	}
	for _, field := range []string{"memeToken", "quoteAsset", "curve", "gauge", "sourceVersion", "launchPhase"} {
		if market[field] == nil || !reflect.DeepEqual(market[field], route[field]) {
			return fail()
		}
	}
	if !reflect.DeepEqual(market["graduatedHook"], route["hook"]) {
		return fail()
	}
	// Runtime hashes are observations, not a claim of audited implementation.
	for _, field := range []string{"swapRouter", "quoter", "graduationExecutor"} {
		hash, ok := runtime[field].(string)
		if !ok || len(hash) != 66 || hash[:2] != "0x" {
			return fail()
		}
		for _, c := range hash[2:] {
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
				return fail()
			}
		}
	}
	number := func(v any, bits int) (uint64, bool) {
		s, ok := v.(string)
		if !ok {
			return 0, false
		}
		n, e := strconv.ParseUint(s, 10, bits)
		return n, e == nil && strconv.FormatUint(n, 10) == s
	}
	version, ok := number(market["sourceVersion"], 32)
	if !ok {
		return fail()
	}
	phase, ok := number(market["launchPhase"], 8)
	if !ok {
		return fail()
	}
	result := map[string]any{"marketId": id, "source": source, "sourceVersion": version, "launchPhase": phase}
	for _, field := range []string{"assetUid", "memeToken", "curve", "gauge", "quoteAsset", "quoteAssetConfigId", "tickerGardenBaselineId"} {
		result[field] = market[field]
	}
	progress := map[string]any{}
	for _, field := range []string{"realQuoteReserve", "sellableTokens", "reservedTokens", "accruedCurveFees", "readyToGraduate"} {
		progress[field] = curve[field]
	}
	result["curveProgress"] = progress
	result["canonicalRoute"] = map[string]any{"router": route["swapRouter"], "quoter": route["quoter"], "hook": route["hook"], "launchLocker": route["launchLocker"], "graduationExecutor": route["graduationExecutor"], "curveTradingEnabled": route["curveTradingEnabled"], "poolTradingEnabled": route["poolTradingEnabled"], "sourceVersion": version, "launchPhase": phase}
	result["poolId"] = nil
	result["poolKey"] = nil
	if phase == 1 {
		if !reflect.DeepEqual(market["poolId"], route["poolId"]) {
			return fail()
		}
		fee, ok := number(pool["fee"], 24)
		if !ok {
			return fail()
		}
		spacing, ok := pool["tickSpacing"].(string)
		if !ok {
			return fail()
		}
		tick, e := strconv.ParseInt(spacing, 10, 24)
		if e != nil || strconv.FormatInt(tick, 10) != spacing {
			return fail()
		}
		for _, field := range []string{"currency0", "currency1", "fee", "tickSpacing", "hooks"} {
			if pool[field] == nil || !reflect.DeepEqual(pool[field], route[field]) {
				return fail()
			}
		}
		result["poolId"] = market["poolId"]
		result["poolKey"] = map[string]any{"currency0": pool["currency0"], "currency1": pool["currency1"], "fee": fee, "tickSpacing": tick, "hooks": pool["hooks"]}
	}
	height := strconv.FormatUint(block, 10)
	envelope := map[string]any{"executionSpecId": "V1-EXEC-11", "reconciliationAlerts": []any{}, "sync": map[string]any{"chainId": batch.ChainID, "status": "synced", "blockNumber": height, "blockHash": batch.BlockHash, "headBlockNumber": height, "headBlockHash": batch.BlockHash, "finality": "finalized", "lagBlocks": "0", "revision": height + ":" + batch.BlockHash}, "markets": []any{result}, "configs": []any{}, "positions": []any{}}
	raw, e := json.Marshal(envelope)
	if e != nil {
		return fail()
	}
	validated, e := Parse(raw, batch.ChainID)
	if e != nil {
		return fail()
	}
	return validated.Markets[0], nil
}
