package deployment

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"tickergarden/backend/internal/chainrpc"
)

// BindingObserver must honor the same canonical block hash for every state read.
type BindingObserver interface {
	Observer
	CallAt(context.Context, string, string, string) ([]byte, error)
}

// Ordering is the canonical TickerGardenFactoryV1.runtimeBindings() ABI.
var runtimeModules = [...]string{
	"OfficialStockRegistryV1", "ApprovedQuoteRegistry", "TickerGardenBaselineRegistry",
	"LaunchTemplateRegistry", "MarketRegistryV1", "ProtocolFeeVault",
	"AllocationManager", "LaunchAndBuyRouter",
}

// VerifyCoreBindings checks runtime identities, the Factory's eight immutable
// roots, the Registry's reciprocal Factory/four configuration roots and the
// quote Registry's stock Registry. It does not authenticate market instances,
// routing dependencies, implementation templates, permissions or economics.
// A successful result is only valid for the supplied chain and block hash.
func VerifyCoreBindings(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header) (Verified, error) {
	required := map[string]string{"TickerGardenFactoryV1": ""}
	for _, module := range runtimeModules {
		required[module] = ""
	}
	for _, c := range m.Contracts {
		if current, ok := required[c.Module]; ok {
			if current != "" {
				return Verified{}, fmt.Errorf("ambiguous core module: %s", c.Module)
			}
			required[c.Module] = c.Address
		}
	}
	for module, address := range required {
		if address == "" {
			return Verified{}, fmt.Errorf("missing core module: %s", module)
		}
	}
	v, err := Verify(ctx, rpc, m, block)
	if err != nil {
		return Verified{}, err
	}
	var batch []chainrpc.StateCall
	batch = append(batch, chainrpc.StateCall{Address: required["TickerGardenFactoryV1"], Data: Hash([]byte("runtimeBindings()"))[:10]})
	for _, signature := range []string{"factory()", "officialStockRegistry()", "approvedQuoteRegistry()", "tickerGardenBaselineRegistry()", "launchTemplateRegistry()"} {
		batch = append(batch, chainrpc.StateCall{Address: required["MarketRegistryV1"], Data: Hash([]byte(signature))[:10]})
	}
	batch = append(batch, chainrpc.StateCall{Address: required["ApprovedQuoteRegistry"], Data: Hash([]byte("officialStockRegistry()"))[:10]})
	rpc, err = prefetchCalls(ctx, rpc, block.Hash, batch)
	if err != nil {
		return Verified{}, err
	}
	read := func(module, signature string, count int) ([]string, error) {
		data, err := rpc.CallAt(ctx, required[module], Hash([]byte(signature))[:10], block.Hash)
		if err != nil {
			// Keep endpoints and provider response bodies out of diagnostics.
			return nil, fmt.Errorf("core binding observation failed: %s.%s", module, signature)
		}
		if len(data) != count*32 {
			return nil, errors.New("invalid core binding ABI length")
		}
		addresses := make([]string, count)
		for i := range addresses {
			word := data[i*32 : (i+1)*32]
			for _, b := range word[:12] {
				if b != 0 {
					return nil, errors.New("invalid core binding address padding")
				}
			}
			addresses[i] = "0x" + hex.EncodeToString(word[12:])
			if addresses[i] == "0x"+strings.Repeat("0", 40) {
				return nil, errors.New("zero core binding address")
			}
		}
		return addresses, nil
	}
	values, err := read("TickerGardenFactoryV1", "runtimeBindings()", len(runtimeModules))
	if err != nil {
		return Verified{}, err
	}
	for i, module := range runtimeModules {
		if values[i] != required[module] {
			return Verified{}, fmt.Errorf("Factory core binding mismatch: %s", module)
		}
	}
	for _, edge := range [][3]string{
		{"MarketRegistryV1", "factory()", "TickerGardenFactoryV1"},
		{"MarketRegistryV1", "officialStockRegistry()", "OfficialStockRegistryV1"},
		{"MarketRegistryV1", "approvedQuoteRegistry()", "ApprovedQuoteRegistry"},
		{"MarketRegistryV1", "tickerGardenBaselineRegistry()", "TickerGardenBaselineRegistry"},
		{"MarketRegistryV1", "launchTemplateRegistry()", "LaunchTemplateRegistry"},
		{"ApprovedQuoteRegistry", "officialStockRegistry()", "OfficialStockRegistryV1"},
	} {
		values, err := read(edge[0], edge[1], 1)
		if err != nil {
			return Verified{}, err
		}
		if values[0] != required[edge[2]] {
			return Verified{}, fmt.Errorf("core binding mismatch: %s.%s", edge[0], edge[1])
		}
	}
	// Recheck after all calls as a reorg may have happened after identity checks.
	canonical, err := rpc.Header(ctx, block.Number)
	if err != nil {
		return Verified{}, err
	}
	if !strings.EqualFold(canonical.Hash, block.Hash) {
		return Verified{}, errors.New("core binding verification block changed")
	}
	return v, nil
}
