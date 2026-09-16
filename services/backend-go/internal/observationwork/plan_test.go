package observationwork

import (
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

const testAddress = "0x1111111111111111111111111111111111111111"

func testManifest() deployment.Manifest {
	return deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 4663,
		GenesisHash: "0x" + strings.Repeat("a", 64), Contracts: []deployment.Contract{{
			Module: "TickerGardenFactoryV1", Address: testAddress, RuntimeCodeHash: "0x" + strings.Repeat("b", 64),
		}}}
}

func testHeader() chainrpc.Header {
	return chainrpc.Header{Number: "0x10", Hash: "0x" + strings.Repeat("c", 64), Timestamp: "0x1"}
}

func market(id, quote, meme string) deployment.MarketDiscovery {
	return deployment.MarketDiscovery{MarketID: id, State: map[string]any{"quoteAsset": quote, "memeToken": meme, "stakingEnabled": false}}
}

func TestPlanDisjointMarketsProduceFourRequests(t *testing.T) {
	markets := map[string]deployment.MarketDiscovery{
		"a": market("a", "0x"+strings.Repeat("1", 40), "0x"+strings.Repeat("2", 40)),
		"b": market("b", "0x"+strings.Repeat("3", 40), "0x"+strings.Repeat("4", 40)),
	}
	requests, err := Plan(testManifest(), testHeader(), markets, nil)
	if err != nil || len(requests) != 4 {
		t.Fatalf("Plan: %d requests, %v", len(requests), err)
	}
}

func TestPlanSharedAndTransitiveAssetsCollapseComponent(t *testing.T) {
	m1, m2, m3 := "0x"+strings.Repeat("1", 40), "0x"+strings.Repeat("2", 40), "0x"+strings.Repeat("3", 40)
	markets := map[string]deployment.MarketDiscovery{
		"a": market("a", m1, m2), "b": market("b", m3, m1), "c": market("c", m3, "0x"+strings.Repeat("4", 40)),
	}
	requests, err := Plan(testManifest(), testHeader(), markets, nil)
	if err != nil || len(requests) != 2 {
		t.Fatalf("shared component: %d requests, %v", len(requests), err)
	}
	if len(requests[0].Markets) != 3 {
		t.Fatalf("component markets = %d", len(requests[0].Markets))
	}
}

func TestPlanHistoricalDependenciesCollapseGroups(t *testing.T) {
	markets := map[string]deployment.MarketDiscovery{
		"a": market("a", "0x"+strings.Repeat("1", 40), "0x"+strings.Repeat("2", 40)),
		"b": market("b", "0x"+strings.Repeat("3", 40), "0x"+strings.Repeat("4", 40)),
	}
	requests, err := Plan(testManifest(), testHeader(), markets, []deployment.ServiceAssetTarget{{Distributor: testAddress, Asset: testAddress}})
	if err != nil || len(requests) != 2 {
		t.Fatalf("historical collapse: %d requests, %v", len(requests), err)
	}
}

func TestPlanRejectsInvalidAccountingAddress(t *testing.T) {
	_, err := Plan(testManifest(), testHeader(), map[string]deployment.MarketDiscovery{"a": market("a", "bad", testAddress)}, nil)
	if err == nil {
		t.Fatal("accepted invalid accounting address")
	}
}

func TestRequestDigestDeterministic(t *testing.T) {
	r := Request{Version: Version, Kind: "fees", Manifest: testManifest(), Block: testHeader(), Markets: map[string]deployment.MarketDiscovery{
		"b": market("b", "0x"+strings.Repeat("3", 40), "0x"+strings.Repeat("4", 40)), "a": market("a", "0x"+strings.Repeat("1", 40), "0x"+strings.Repeat("2", 40)),
	}}
	_, d1, err1 := r.Encode()
	_, d2, err2 := r.Encode()
	if err1 != nil || err2 != nil || d1 != d2 {
		t.Fatalf("digest not deterministic: %q %q (%v, %v)", d1, d2, err1, err2)
	}
}

func batch(r Request, observations ...deployment.StateObservation) deployment.ObservationBatch {
	scope := deployment.FeeObservationScope
	if r.Kind == "holders" {
		scope = deployment.HolderObservationScope
	}
	return deployment.ObservationBatch{Scope: scope, ChainID: r.Manifest.ChainID, BlockNumber: r.Block.Number, BlockHash: r.Block.Hash, Expected: len(observations), Observations: observations}
}

func TestMergeRejectsMissingPhaseMixedBlockAndConflictingDuplicate(t *testing.T) {
	base := Request{Version: Version, Kind: "fees", Manifest: testManifest(), Block: testHeader()}
	holder := base
	holder.Kind = "holders"
	obs := deployment.StateObservation{Kind: "x", Key: "y"}
	if _, _, err := Merge([]Request{base}, []deployment.ObservationBatch{batch(base)}); err == nil {
		t.Fatal("accepted missing phase")
	}
	other := base
	other.Block.Hash = "0x" + strings.Repeat("d", 64)
	if _, _, err := Merge([]Request{base, holder}, []deployment.ObservationBatch{batch(base, obs), batch(other)}); err == nil {
		t.Fatal("accepted mixed block")
	}
	dup := holder
	if _, _, err := Merge([]Request{base, holder, dup}, []deployment.ObservationBatch{batch(base, obs), batch(holder, obs), batch(dup, deployment.StateObservation{Kind: "x", Key: "y", Value: map[string]any{"conflict": true}})}); err == nil {
		t.Fatal("accepted conflicting duplicate")
	}
}
