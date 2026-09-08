package deployment

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// MarketDiscovery is an end-of-block observation, not transaction-time state or
// a reconciled financial projection. Runtime hashes here are observed evidence;
// instance authority comes from the verified Factory and Registry relationship.
type MarketDiscovery struct {
	MarketID  string         `json:"marketId"`
	Source    chainrpc.Log   `json:"source"`
	State     map[string]any `json:"state"`
	Contracts []Contract     `json:"contracts"`
}

type DiscoveryObserver interface {
	BindingObserver
	Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error)
}

var marketFields = []events.Input{
	{Name: "assetUid", Type: "bytes32"}, {Name: "tickerGardenBaselineId", Type: "bytes32"},
	{Name: "quoteAssetConfigId", Type: "bytes32"}, {Name: "launchTemplateId", Type: "bytes32"},
	{Name: "feePolicyId", Type: "bytes32"}, {Name: "executionSpecId", Type: "bytes32"},
	{Name: "expectedEconomics", Type: "bytes32"}, {Name: "launchConfigId", Type: "uint256"},
	{Name: "creatorRevenueBeneficiaryAtCreation", Type: "address"}, {Name: "memeToken", Type: "address"},
	{Name: "curve", Type: "address"}, {Name: "gauge", Type: "address"}, {Name: "quoteAsset", Type: "address"},
	{Name: "graduatedHook", Type: "address"}, {Name: "creatorTaxBps", Type: "uint16"},
	{Name: "creatorFeesToHolders", Type: "bool"}, {Name: "stakingEnabled", Type: "bool"},
	{Name: "poolId", Type: "bytes32"}, {Name: "sourceVersion", Type: "uint32"}, {Name: "launchPhase", Type: "uint8"},
}

// DiscoverBlock authenticates the core deployment, obtains receipt-checked logs,
// and reconciles every Factory MarketCreated with the Registry's immutable record
// and reverse token lookup. Arbitrary callers' lookalike events are ignored.
// No partial batch escapes on errors, including a reorg after the last state read.
func DiscoverBlock(ctx context.Context, rpc DiscoveryObserver, manifest Manifest, block chainrpc.Header) ([]MarketDiscovery, error) {
	v, err := VerifyCoreBindings(ctx, rpc, manifest, block)
	if err != nil {
		return nil, err
	}
	var factory, registry string
	for _, c := range manifest.Contracts {
		if c.Module == "TickerGardenFactoryV1" {
			factory = c.Address
		}
		if c.Module == "MarketRegistryV1" {
			registry = c.Address
		}
	}
	observation, err := rpc.Observe(ctx, block)
	if err != nil {
		return nil, err
	}
	result := make([]MarketDiscovery, 0)
	seen := map[string]bool{}
	instances := map[string]bool{}
	topic := Hash([]byte("MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)"))
	for _, log := range observation.Logs {
		if !strings.EqualFold(log.Address, factory) || len(log.Topics) == 0 || !strings.EqualFold(log.Topics[0], topic) {
			continue
		}
		event, err := v.Decode(manifest.ChainID, log)
		if err != nil {
			return nil, err
		}
		id := event.Args["marketId"].(string)
		if id == zero32 || seen[id] {
			return nil, errors.New("invalid or duplicate market creation")
		}
		seen[id] = true
		raw, err := rpc.CallAt(ctx, registry, Hash([]byte("market(bytes32)"))[:10]+id[2:], block.Hash)
		if err != nil {
			return nil, errors.New("market record observation failed")
		}
		state, err := events.DecodeStatic(marketFields, raw)
		if err != nil {
			return nil, err
		}
		for _, name := range []string{"assetUid", "memeToken", "curve", "gauge", "quoteAsset", "tickerGardenBaselineId", "quoteAssetConfigId", "expectedEconomics"} {
			if state[name] != event.Args[name] {
				return nil, errors.New("Factory event and market record mismatch: " + name)
			}
		}
		if err := validateMarketState(state); err != nil {
			return nil, err
		}
		token := state["memeToken"].(string)
		reverse, err := rpc.CallAt(ctx, registry, Hash([]byte("marketIdByToken(address)"))[:10]+strings.Repeat("0", 24)+token[2:], block.Hash)
		if err != nil {
			return nil, errors.New("market reverse identity observation failed")
		}
		decoded, err := events.DecodeStatic([]events.Input{{Name: "id", Type: "bytes32"}}, reverse)
		if err != nil || decoded["id"] != id {
			return nil, errors.New("market reverse identity mismatch")
		}
		item := MarketDiscovery{MarketID: id, Source: log, State: state, Contracts: make([]Contract, 0, 3)}
		for _, binding := range [][2]string{{"memeToken", "TickerMemeTokenV1"}, {"curve", "TickerGardenCurve"}, {"gauge", "MemeStockGauge"}} {
			address := state[binding[0]].(string)
			if address == zero20 {
				continue
			} // Disabled staking deliberately has no Gauge.
			if instances[address] || (v.contracts[address] != "" && v.contracts[address] != binding[1]) {
				return nil, errors.New("market instance address alias")
			}
			instances[address] = true
			code, err := rpc.CodeAt(ctx, address, block.Hash)
			if err != nil || len(code) == 0 {
				return nil, errors.New("market instance runtime unavailable")
			}
			item.Contracts = append(item.Contracts, Contract{Module: binding[1], Address: address, RuntimeCodeHash: Hash(code)})
		}
		result = append(result, item)
	}
	h, err := rpc.Header(ctx, block.Number)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(h.Hash, block.Hash) {
		return nil, errors.New("market discovery block changed")
	}
	return result, nil
}

var zero20 = "0x" + strings.Repeat("0", 40)
var zero32 = "0x" + strings.Repeat("0", 64)

func validateMarketState(s map[string]any) error {
	for _, field := range []string{"tickerGardenBaselineId", "quoteAssetConfigId", "launchTemplateId", "feePolicyId", "expectedEconomics"} {
		if s[field] == zero32 {
			return errors.New("zero market configuration identity")
		}
	}
	for _, field := range []string{"memeToken", "curve", "graduatedHook", "creatorRevenueBeneficiaryAtCreation"} {
		if s[field] == zero20 {
			return errors.New("zero required market address")
		}
	}
	if s["executionSpecId"] != Hash([]byte("V1-EXEC-11")) || s["quoteAsset"] == s["memeToken"] {
		return errors.New("invalid market identity")
	}
	if s["stakingEnabled"] == true {
		if s["assetUid"] == zero32 || s["gauge"] == zero20 {
			return errors.New("missing enabled staking binding")
		}
	} else if s["assetUid"] != zero32 || s["gauge"] != zero20 {
		return errors.New("disabled staking has bindings")
	}
	tax, _ := strconv.ParseUint(s["creatorTaxBps"].(string), 10, 16)
	hook := s["graduatedHook"].(string)
	mask, _ := strconv.ParseUint(hook[len(hook)-4:], 16, 16)
	if tax > 500 || mask&0x3fff != 0x2044 {
		return errors.New("invalid market tax or hook permissions")
	}
	// Registry phases are 0 (curve) and 1 (pool created). A creation transaction
	// can also graduate; the observed end-of-block phase need not be zero.
	if (s["launchPhase"] == "0" && (s["sourceVersion"] != "1" || s["poolId"] != zero32)) ||
		(s["launchPhase"] == "1" && (s["sourceVersion"] != "2" || s["poolId"] == zero32)) ||
		(s["launchPhase"] != "0" && s["launchPhase"] != "1") {
		return errors.New("invalid market runtime transition")
	}
	return nil
}
