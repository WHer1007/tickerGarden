package integration

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/feeledger"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/testfixture/readmodelpublication"
)

// financialPublicationRPCFixture is a request-aware RPC fixture for the
// single-market publication path. Exact responses are supplied by the caller;
// unknown calls are recorded and rejected, so a test cannot silently fall back
// to a fabricated zero value.
type financialPublicationRPCFixture struct {
	*httptest.Server
	mu      sync.Mutex
	missing []string
}

func newFinancialPublicationRPCFixture(t *testing.T, m deployment.Manifest, c readmodel.CandidateSet, responses map[string]string, codes map[string]bool) *financialPublicationRPCFixture {
	t.Helper()
	f := &financialPublicationRPCFixture{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var q struct {
			ID     json.RawMessage   `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&q) != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		var result any
		switch q.Method {
		case "eth_chainId":
			result = fmt.Sprintf("0x%x", m.ChainID)
		case "eth_getCode":
			var address string
			if len(q.Params) == 2 && json.Unmarshal(q.Params[0], &address) == nil && codes[strings.ToLower(address)] {
				result = "0x01"
			} else {
				f.recordMissing("eth_getCode")
				http.Error(w, "missing code fixture", http.StatusBadRequest)
				return
			}
		case "eth_call":
			var call struct{ To, Data string }
			if len(q.Params) != 2 || json.Unmarshal(q.Params[0], &call) != nil {
				f.recordMissing("eth_call:malformed")
				http.Error(w, "missing call fixture", http.StatusBadRequest)
				return
			}
			key := strings.ToLower(call.To) + ":" + strings.ToLower(call.Data)
			var ok bool
			result, ok = responses[key]
			if !ok {
				f.recordMissing(key)
				http.Error(w, "missing call fixture", http.StatusBadRequest)
				return
			}
		default:
			f.recordMissing(q.Method)
			http.Error(w, "unsupported fixture method", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "result": result})
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *financialPublicationRPCFixture) recordMissing(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.missing = append(f.missing, key)
}

func (f *financialPublicationRPCFixture) missingCalls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.missing...)
}

// augmentFinancialPublicationRPCResponses encodes the single-market curve-phase
// state used by the publication CLI test. Any newly added observer selector is
// absent and therefore fails closed in the request-aware fixture.
func augmentFinancialPublicationRPCResponses(m deployment.Manifest, c readmodel.CandidateSet, responses map[string]string, codes map[string]bool) {
	word := func(value string) string {
		value = strings.TrimPrefix(value, "0x")
		return strings.Repeat("0", 64-len(value)) + value
	}
	number := func(value string) string {
		if value == "" {
			value = "0"
		}
		parsed, ok := new(big.Int).SetString(value, 10)
		if !ok {
			panic("invalid publication fixture integer: " + value)
		}
		return fmt.Sprintf("%064x", parsed)
	}
	boolean := func(value bool) string {
		if value {
			return fmt.Sprintf("%064x", 1)
		}
		return strings.Repeat("0", 64)
	}
	put := func(target, signature, args, result string) {
		responses[strings.ToLower(target)+":"+deployment.Hash([]byte(signature))[:10]+strings.ToLower(args)] = "0x" + result
	}
	addresses := map[string]string{}
	for _, contract := range m.Contracts {
		addresses[contract.Module] = strings.ToLower(contract.Address)
		codes[strings.ToLower(contract.Address)] = true
	}
	if len(c.Markets) != 1 {
		panic("publication RPC fixture requires one market")
	}
	market := c.Markets[0]
	for _, address := range []string{market.MemeToken, market.QuoteAsset, market.Curve, market.Gauge, market.CanonicalRoute.Router, market.CanonicalRoute.Quoter, market.CanonicalRoute.Hook, market.CanonicalRoute.GraduationExecutor} {
		if address != "0x"+strings.Repeat("0", 40) {
			codes[strings.ToLower(address)] = true
		}
	}
	configs := map[string]readmodel.ConfigReadModel{}
	for _, config := range c.Configs {
		configs[config.Kind+":"+config.ID] = config
	}
	baseline := configs["baseline:"+market.TickerGardenBaselineID]
	quote := configs["quote:"+market.QuoteAssetConfigID]
	templateID, _ := marketSourceValue(c, market.MarketID, "launchTemplateId")
	template := configs["template:"+templateID]
	tick := fmt.Sprintf("%064x", uint64(baseline.Values["tickSpacing"].(int64)))
	currency0, currency1 := market.MemeToken, market.QuoteAsset
	if currency1 < currency0 {
		currency0, currency1 = currency1, currency0
	}
	poolRaw := word(currency0) + word(currency1) + number("0") + tick + word(market.CanonicalRoute.Hook)
	poolBytes, _ := hex.DecodeString(poolRaw)
	poolID := deployment.Hash(poolBytes)
	registry := addresses["MarketRegistryV1"]
	marketFields := []string{
		market.AssetUID, market.TickerGardenBaselineID, market.QuoteAssetConfigID, templateID,
		template.Values["feePolicyId"].(string), template.Values["executionSpecId"].(string),
		mustMarketSourceValue(c, market.MarketID, "expectedEconomics"), mustMarketSourceValue(c, market.MarketID, "launchConfigId"),
		mustMarketSourceValue(c, market.MarketID, "creatorRevenueBeneficiaryAtCreation"), market.MemeToken,
		market.Curve, market.Gauge, market.QuoteAsset, market.CanonicalRoute.Hook,
		mustMarketSourceValue(c, market.MarketID, "creatorTaxBps"), boolDecimal(mustMarketSourceValue(c, market.MarketID, "creatorFeesToHolders")), boolDecimal(mustMarketSourceValue(c, market.MarketID, "stakingEnabled")),
		"0x" + strings.Repeat("0", 64), fmt.Sprint(market.SourceVersion), fmt.Sprint(market.LaunchPhase),
	}
	encodedMarket := ""
	for i, value := range marketFields {
		if i == 15 || i == 16 {
			encodedMarket += boolean(value == "1")
		} else if i == 7 || i == 14 || i == 18 || i == 19 {
			encodedMarket += number(value)
		} else {
			encodedMarket += word(value)
		}
	}
	put(registry, "market(bytes32)", market.MarketID[2:], encodedMarket)
	put(registry, "marketIdByToken(address)", word(market.MemeToken), word(market.MarketID))
	put(registry, "canonicalPoolKey(bytes32)", market.MarketID[2:], poolRaw)
	put(registry, "canonicalPoolId(bytes32)", market.MarketID[2:], word(poolID))
	route := poolRaw
	for _, value := range []string{poolID, market.CanonicalRoute.Router, market.CanonicalRoute.Quoter, market.CanonicalRoute.Hook, market.QuoteAsset, market.MemeToken, market.Gauge, market.Curve, market.CanonicalRoute.LaunchLocker, fmt.Sprint(market.SourceVersion), fmt.Sprint(market.LaunchPhase)} {
		route += word(value)
	}
	route += boolean(market.CanonicalRoute.CurveTradingEnabled) + boolean(market.CanonicalRoute.PoolTradingEnabled)
	put(registry, "canonicalRoute(bytes32)", market.MarketID[2:], route)
	put(registry, "swapRouter()", "", word(market.CanonicalRoute.Router))
	put(registry, "quoter()", "", word(market.CanonicalRoute.Quoter))
	put(registry, "graduationExecutor()", "", word(market.CanonicalRoute.GraduationExecutor))
	put(registry, "activeFeeSource(bytes32)", market.MarketID[2:], word(market.Curve)+number(fmt.Sprint(market.SourceVersion)))

	put(market.Curve, "quoteAsset()", "", word(market.QuoteAsset))
	put(market.Curve, "realQuoteReserve()", "", number(market.CurveProgress.RealQuoteReserve))
	put(market.Curve, "sellableTokens()", "", number(market.CurveProgress.SellableTokens))
	put(market.Curve, "reservedTokens()", "", number(market.CurveProgress.ReservedTokens))
	put(market.Curve, "accruedCurveFees()", "", number(market.CurveProgress.AccruedCurveFees))
	put(market.Curve, "readyToGraduate()", "", boolean(market.CurveProgress.ReadyToGraduate))
	if asset, ok := configs["asset:"+market.AssetUID]; ok {
		put(asset.Values["userStockVault"].(string), "marketAllocated(bytes32,bytes32)", market.AssetUID[2:]+market.MarketID[2:], number("0"))
	}

	quoteRegistry := addresses["ApprovedQuoteRegistry"]
	put(quoteRegistry, "quoteConfig(bytes32)", quote.ID[2:], word(quote.Values["tickerGardenBaselineId"].(string))+word(quote.Values["quoteAsset"].(string))+number(fmt.Sprint(quote.Values["quoteDecimals"]))+number(quote.Values["phantomQuote"].(string))+number(quote.Values["graduationThreshold"].(string))+word(quote.Values["economicsHash"].(string))+number(fmt.Sprint(quote.Status)))
	put(quoteRegistry, "stockQuoteBinding(bytes32)", quote.ID[2:], word(quote.Values["assetUid"].(string))+word(quote.Values["stockTokenFingerprintHash"].(string))+word(quote.Values["referenceEvidenceHash"].(string))+word(quote.Values["generatorPolicyId"].(string)))
	put(quoteRegistry, "quoteRuntimeCodeHash(bytes32)", quote.ID[2:], word(quote.Values["runtimeCodeHash"].(string)))
	put(quoteRegistry, "quoteIdentityCurrent(bytes32)", quote.ID[2:], boolean(quote.Values["identityCurrent"].(bool)))
	put(addresses["TickerGardenBaselineRegistry"], "baseline(bytes32)", baseline.ID[2:], number(baseline.Values["referenceChainId"].(string))+word(baseline.Values["referenceFactory"].(string))+word(baseline.Values["referenceFactoryCodeHash"].(string))+number(baseline.Values["launchConfigId"].(string))+number(baseline.Values["supply"].(string))+number(baseline.Values["curveFeeBps"].(string))+number(fmt.Sprint(baseline.Values["poolFee"]))+number(fmt.Sprint(baseline.Values["tickSpacing"]))+word(baseline.Values["behaviorVectorRoot"].(string))+number(fmt.Sprint(baseline.Status)))
	templateRaw := ""
	for _, field := range []string{"memeTokenImplementation", "memeTokenCodeHash", "curveImplementation", "curveCodeHash", "gaugeImplementation", "gaugeCodeHash", "graduatedHook", "hookCodeHash", "graduationExecutor", "graduationExecutorCodeHash", "feePolicyId", "executionSpecId"} {
		templateRaw += word(template.Values[field].(string))
	}
	templateRaw += number(fmt.Sprint(template.Status))
	put(addresses["LaunchTemplateRegistry"], "launchTemplate(bytes32)", template.ID[2:], templateRaw)
	put(addresses["LaunchTemplateRegistry"], "launchTemplateHash(bytes32)", template.ID[2:], word(template.Values["templateHash"].(string)))

	if market.Gauge != "0x"+strings.Repeat("0", 40) {
		put(market.Gauge, "gaugeIdentity()", "", word(market.MarketID)+word(market.AssetUID)+word(market.QuoteAssetConfigID)+word(addresses["AllocationManager"])+word(addresses["ProtocolFeeVault"])+word(market.QuoteAsset)+word(market.MemeToken))
		put(market.Gauge, "storedTotalActiveStock()", "", number("0"))
		put(market.Gauge, "totalPendingStock()", "", number("0"))
	}
	vault := addresses["ProtocolFeeVault"]
	liabilities := map[string]map[string]string{}
	var probes []feeledger.Probe
	if c.FeeReconciliation != nil && c.FeeReconciliation.Report != nil {
		probes = c.FeeReconciliation.Report.Probes
	}
	for _, probe := range probes {
		if probe.Kind == "feeLiability" {
			if liabilities[probe.Key] == nil {
				liabilities[probe.Key] = map[string]string{}
			}
			liabilities[probe.Key][probe.Field] = probe.Expected
		}
	}
	for _, asset := range []string{market.QuoteAsset, market.MemeToken} {
		key := market.MarketID + ":" + asset
		for bucket, field := range []string{"creator", "staker", "platform", "holder"} {
			put(vault, "liability(bytes32,address,uint8)", market.MarketID[2:]+word(asset)+number(fmt.Sprint(bucket)), number(liabilities[key][field]))
		}
		put(vault, "forfeitureReserve(bytes32,address)", market.MarketID[2:]+word(asset), number(liabilities[key]["forfeitureReserve"]))
		total := "0"
		for _, probe := range probes {
			if probe.Kind == "feeSolvency" && probe.Key == asset && probe.Field == "totalLiability" {
				total = probe.Expected
			}
		}
		put(vault, "totalLiability(address)", word(asset), number(total))
		put(asset, "balanceOf(address)", word(vault), number(total))
	}
	creator := addresses["CreatorRevenueRegistry"]
	put(vault, "creatorRevenueRegistry()", "", word(creator))
	put(vault, "marketRegistry()", "", word(registry))
	put(creator, "marketRegistry()", "", word(registry))
	put(creator, "factory()", "", word(addresses["TickerGardenFactoryV1"]))
	put(creator, "currentCreatorEpoch(bytes32)", market.MarketID[2:], number(fmt.Sprint(len(c.CreatorEpochs))))
	for _, epoch := range c.CreatorEpochs {
		args := epoch.MarketID[2:] + number(epoch.Epoch)
		put(creator, "creatorBeneficiaryAt(bytes32,uint32)", args, word(epoch.Beneficiary))
		put(vault, "creatorLiability(bytes32,uint32,address)", args+word(epoch.QuoteAsset), number(epoch.QuoteLiability))
		put(vault, "creatorLiability(bytes32,uint32,address)", args+word(epoch.MemeAsset), number(epoch.MemeLiability))
	}
}

func boolDecimal(value string) string {
	if value == "true" {
		return "1"
	}
	return "0"
}

func marketSourceValue(c readmodel.CandidateSet, marketID, field string) (string, bool) {
	for _, market := range c.Markets {
		if market.MarketID != marketID {
			continue
		}
		switch field {
		case "launchTemplateId":
			for _, config := range c.Configs {
				if config.Kind == "template" && config.Values["graduatedHook"] == market.CanonicalRoute.Hook {
					return config.ID, true
				}
			}
		case "expectedEconomics":
			for _, config := range c.Configs {
				if config.Kind == "quote" && config.ID == market.QuoteAssetConfigID {
					return config.Values["economicsHash"].(string), true
				}
			}
		case "launchConfigId":
			for _, config := range c.Configs {
				if config.Kind == "baseline" && config.ID == market.TickerGardenBaselineID {
					return config.Values["launchConfigId"].(string), true
				}
			}
		case "creatorRevenueBeneficiaryAtCreation":
			if len(c.CreatorEpochs) > 0 {
				return c.CreatorEpochs[0].Beneficiary, true
			}
		case "creatorTaxBps":
			return "0", true
		case "creatorFeesToHolders":
			return "false", true
		case "stakingEnabled":
			return fmt.Sprint(market.Gauge != "0x"+strings.Repeat("0", 40)), true
		}
	}
	return "", false
}

func mustMarketSourceValue(c readmodel.CandidateSet, marketID, field string) string {
	value, ok := marketSourceValue(c, marketID, field)
	if !ok {
		panic("missing market fixture field: " + field)
	}
	return value
}

func TestFinancialPublicationRPCFixtureRejectsUnlistedDynamicSelectors(t *testing.T) {
	manifest := deployment.Manifest{ChainID: 46630}
	candidate := readmodel.CandidateSet{ChainID: 46630}
	fixture := newFinancialPublicationRPCFixture(t, manifest, candidate, map[string]string{}, map[string]bool{})
	// The helper must fail closed for an unlisted dynamic call. This keeps later
	// single-market fixtures honest when a verifier adds a new selector.
	resp, err := http.Post(fixture.URL, "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x0000000000000000000000000000000000000001","data":"0xdeadbeef"},"latest"]}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(fixture.missingCalls()) != 1 {
		t.Fatalf("missing selector was not recorded: %v", fixture.missingCalls())
	}
}

func TestAugmentFinancialPublicationRPCResponsesInstallsSelectorInventory(t *testing.T) {
	f, err := readmodelpublication.Load()
	if err != nil {
		t.Fatal(err)
	}
	c, err := readmodel.BuildCandidateSet(f.FullObservationBatch, f.Sources)
	if err != nil {
		t.Fatal(err)
	}
	contracts, _, _ := candidateAssetFixture("0x"+strings.Repeat("7", 40), f.MemeToken, "0x"+strings.Repeat("8", 40), f.AssetUID)
	contracts = append(contracts, deployment.Contract{Module: "CreatorRevenueRegistry", Address: "0x" + strings.Repeat("9", 40), RuntimeCodeHash: deployment.Hash([]byte{1})})
	m := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: f.ChainID, GenesisHash: "0x" + strings.Repeat("a", 64), Contracts: contracts}
	responses, codes := map[string]string{}, map[string]bool{}
	augmentFinancialPublicationRPCResponses(m, c, responses, codes)
	for _, want := range []string{"canonicalPoolKey(bytes32)", "market(bytes32)", "marketIdByToken(address)", "reservedTokens()", "gaugeIdentity()", "storedTotalActiveStock()", "creatorRevenueRegistry()"} {
		found := false
		selector := deployment.Hash([]byte(want))[:10]
		for key := range responses {
			if strings.Contains(key, ":"+selector) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("missing selector %s", want)
		}
	}
	if len(codes) < len(m.Contracts)+2 {
		t.Fatalf("code inventory=%d, want manifest plus dynamic market contracts", len(codes))
	}
}
