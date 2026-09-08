package deployment

import (
	"context"
	"strings"
	"testing"
)

func TestObserveAssetBlockHistoricalAccountsDeduplicate(t *testing.T) {
	f, b, market, user, _, _, _ := vaultFixture(t)
	id := market.State["assetUid"].(string)
	assets, err := DiscoverAssets(context.Background(), f, f.manifest, b, map[string]bool{id: true})
	if err != nil {
		t.Fatal(err)
	}
	f.manifest.Contracts = append(f.manifest.Contracts, assets[id].Vault)
	verified, err := VerifyCoreBindings(context.Background(), f, f.manifest, b)
	if err != nil {
		t.Fatal(err)
	}
	h := VaultAccount{AssetUID: id, User: user, MarketID: market.MarketID}
	batch, err := ObserveAssetBlock(context.Background(), f, b, f.manifest.ChainID, verified, assets, map[string]MarketDiscovery{market.MarketID: market}, nil, h, h)
	if err != nil {
		t.Fatal(err)
	}
	if batch.Expected != len(batch.Observations) {
		t.Fatalf("expected=%d observations=%d", batch.Expected, len(batch.Observations))
	}

	solvency := batch.Observations[1].Value
	if solvency["knownUserDepositedSum"] != "90" || solvency["knownUserAllocatedSum"] != "50" || solvency["knownMarketAllocatedSum"] != "60" || solvency["knownUserCount"] != 1 || solvency["fullReconciliation"] != false {
		t.Fatal(solvency)
	}
	if solvency["checks"].(map[string]bool)["knownUserSumEqualsDeposited"] || solvency["checks"].(map[string]bool)["knownUserSumEqualsAllocated"] {
		t.Fatal("incomplete sums passed")
	}
	if batch.Observations[3].Value["knownUserAllocationSum"] != "50" || batch.Observations[3].Value["checks"].(map[string]bool)["knownUserSumEqualsMarketAllocated"] {
		t.Fatal("incomplete market sum passed")
	}
	if len(batch.Observations) != 5 {
		t.Fatalf("unexpected historical refresh count: %d", len(batch.Observations))
	}
}

func TestObserveAssetBlockRejectsInvalidHistoricalAccounts(t *testing.T) {
	f, b, market, user, _, _, _ := vaultFixture(t)
	id := market.State["assetUid"].(string)
	assets, err := DiscoverAssets(context.Background(), f, f.manifest, b, map[string]bool{id: true})
	if err != nil {
		t.Fatal(err)
	}
	f.manifest.Contracts = append(f.manifest.Contracts, assets[id].Vault)
	verified, err := VerifyCoreBindings(context.Background(), f, f.manifest, b)
	if err != nil {
		t.Fatal(err)
	}
	base := VaultAccount{AssetUID: id, User: user, MarketID: market.MarketID}
	for _, bad := range []VaultAccount{{AssetUID: id, User: zero20, MarketID: market.MarketID}, {AssetUID: strings.Repeat("0", 66), User: user, MarketID: market.MarketID}, {AssetUID: id, User: user, MarketID: zero32}} {
		if _, err := ObserveAssetBlock(context.Background(), f, b, f.manifest.ChainID, verified, assets, map[string]MarketDiscovery{market.MarketID: market}, nil, bad); err == nil {
			t.Fatalf("accepted invalid account %+v", bad)
		}
	}
	if _, err := ObserveAssetBlock(context.Background(), f, b, f.manifest.ChainID, verified, assets, map[string]MarketDiscovery{market.MarketID: market}, nil, base); err != nil {
		t.Fatal(err)
	}
}
