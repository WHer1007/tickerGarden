package integration

import (
	"fmt"
	"sort"
	"strings"
	"tickergarden/backend/internal/deployment"
)

func candidateAssetFixture(registry, token, vault, id string) ([]deployment.Contract, map[string]string, map[string]bool) {
	modules := []string{"TickerGardenFactoryV1", "OfficialStockRegistryV1", "ApprovedQuoteRegistry", "TickerGardenBaselineRegistry", "LaunchTemplateRegistry", "MarketRegistryV1", "ProtocolFeeVault", "AllocationManager", "LaunchAndBuyRouter"}
	roots := map[string]string{}
	contracts := []deployment.Contract{}
	codes := map[string]bool{token: true, vault: true}
	for i, module := range modules {
		a := fmt.Sprintf("0x%040x", 20+i)
		if module == "OfficialStockRegistryV1" {
			a = registry
		}
		roots[module] = a
		codes[a] = true
		contracts = append(contracts, deployment.Contract{Module: module, Address: a, RuntimeCodeHash: deployment.Hash([]byte{1})})
	}
	word := func(a string) string { return strings.Repeat("0", 64-len(a[2:])) + a[2:] }
	calls := map[string]string{}
	put := func(target, signature, args, result string) {
		calls[target+":"+deployment.Hash([]byte(signature))[:10]+args] = "0x" + result
	}
	bindings := ""
	for _, module := range modules[1:] {
		bindings += word(roots[module])
	}
	put(roots[modules[0]], "runtimeBindings()", "", bindings)
	for signature, module := range map[string]string{"factory()": modules[0], "officialStockRegistry()": modules[1], "approvedQuoteRegistry()": modules[2], "tickerGardenBaselineRegistry()": modules[3], "launchTemplateRegistry()": modules[4]} {
		put(roots["MarketRegistryV1"], signature, "", word(roots[module]))
	}
	put(roots["ApprovedQuoteRegistry"], "officialStockRegistry()", "", word(registry))
	put(registry, "asset(bytes32)", id[2:], word(token)+word(vault)+fmt.Sprintf("%064x%064x", 18, 1))
	put(registry, "minimumAllocation(bytes32)", id[2:], fmt.Sprintf("%064x", 414))
	put(registry, "assetIdentityCurrent(bytes32)", id[2:], fmt.Sprintf("%064x", 1))
	put(registry, "vaultIdentityCurrent(address)", word(vault), fmt.Sprintf("%064x", 1))
	schema := deployment.Hash([]byte("TickerGarden.UserStockVault.MultiAsset.v6"))
	put(vault, "vaultIdentity()", "", word(registry)+word(roots["MarketRegistryV1"])+word(roots["AllocationManager"])+schema[2:])
	put(registry, "vaultSchemaId(address)", word(vault), schema[2:])
	put(registry, "vaultForSchema(bytes32)", schema[2:], word(vault))
	codeHash := deployment.Hash([]byte{1})
	put(registry, "vaultRuntimeCodeHash(address)", word(vault), codeHash[2:])
	put(registry, "assetFingerprint(bytes32)", id[2:], codeHash[2:]+word(vault)+fmt.Sprintf("%064x", 6)+word(vault)+fmt.Sprintf("%064x", 7))
	put(vault, "totalDeposited(bytes32)", id[2:], fmt.Sprintf("%064x", 0))
	put(vault, "totalAllocated(bytes32)", id[2:], fmt.Sprintf("%064x", 0))
	put(token, "balanceOf(address)", word(vault), fmt.Sprintf("%064x", 0))
	sort.Slice(contracts, func(i, j int) bool { return contracts[i].Address < contracts[j].Address })
	return contracts, calls, codes
}
