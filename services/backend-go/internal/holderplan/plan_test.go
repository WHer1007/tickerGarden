package holderplan

import (
	"context"
	"errors"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

type planRPC struct {
	chain   uint64
	headers map[string]chainrpc.Header
	codes   map[string][]byte
}

func (p *planRPC) ChainID(context.Context) (uint64, error) { return p.chain, nil }
func (p *planRPC) Header(_ context.Context, key string) (chainrpc.Header, error) {
	value, ok := p.headers[key]
	if !ok {
		return chainrpc.Header{}, errors.New("missing header")
	}
	return value, nil
}
func (p *planRPC) CodeAt(_ context.Context, address, hash string) ([]byte, error) {
	value, ok := p.codes[address+":"+hash]
	if !ok {
		return nil, errors.New("missing code")
	}
	return value, nil
}

func planCase() (*planRPC, deployment.Manifest, readmodel.CandidateSet) {
	h := func(c string) string { return "0x" + strings.Repeat(c, 64) }
	a := func(c string) string { return "0x" + strings.Repeat(c, 40) }
	genesis := chainrpc.Header{Number: "0x0", Hash: h("1"), ParentHash: h("0"), Timestamp: "0x0"}
	parent := chainrpc.Header{Number: "0x9", Hash: h("2"), ParentHash: h("1"), Timestamp: "0x9"}
	created := chainrpc.Header{Number: "0xa", Hash: h("3"), ParentHash: parent.Hash, Timestamp: "0xa"}
	finalized := chainrpc.Header{Number: "0xc", Hash: h("4"), ParentHash: h("5"), Timestamp: "0xc"}
	factory, vault, distributor, token := a("1"), a("2"), a("3"), a("4")
	factoryCode, vaultCode, distributorCode, tokenCode := []byte{1}, []byte{2}, []byte{3}, []byte{4}
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 421614, GenesisHash: genesis.Hash, Contracts: []deployment.Contract{
		{Module: "TickerGardenFactoryV1", Address: factory, RuntimeCodeHash: deployment.Hash(factoryCode)},
		{Module: "ProtocolFeeVault", Address: vault, RuntimeCodeHash: deployment.Hash(vaultCode)},
		{Module: "HolderRewardsDistributorV1", Address: distributor, RuntimeCodeHash: deployment.Hash(distributorCode)},
	}}
	marketID := h("6")
	candidate := readmodel.CandidateSet{ChainID: manifest.ChainID, BlockNumber: "12", BlockHash: finalized.Hash,
		Markets:       []readmodel.MarketReadModel{{MarketID: marketID, MemeToken: token, QuoteAsset: a("5"), Source: readmodel.SourceBlock{ChainID: manifest.ChainID, BlockNumber: "10", BlockHash: created.Hash}}},
		HolderMarkets: []readmodel.HolderMarketCandidate{{MarketID: marketID, Distributor: distributor, MemeToken: token, QuoteAsset: a("5"), Mode: "continuous-24h", Continuous: &readmodel.ContinuousHolderCandidate{}}},
	}
	rpc := &planRPC{chain: manifest.ChainID, headers: map[string]chainrpc.Header{"0x0": genesis, "0x9": parent, "0xa": created, "0xc": finalized, "finalized": finalized}, codes: map[string][]byte{
		token + ":" + parent.Hash: {}, token + ":" + created.Hash: tokenCode,
		factory + ":" + created.Hash: factoryCode, vault + ":" + created.Hash: vaultCode, distributor + ":" + created.Hash: distributorCode,
	}}
	return rpc, manifest, candidate
}

func TestBuildProducesCanonicalSeedAndScope(t *testing.T) {
	rpc, manifest, candidate := planCase()
	plan, err := Build(t.Context(), rpc, manifest, candidate, 777)
	if err != nil || plan.Version != 1 || len(plan.Items) != 1 {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
	item := plan.Items[0]
	if item.Seed.BlockNumber != "0xa" || item.Scope.Config.MaxAccounts != 777 || item.Seed.Seed.Scope != item.Scope || item.Seed.Seed.Factory != manifest.Contracts[0].Address || item.Scope.Config.Binding.Vault != manifest.Contracts[1].Address {
		t.Fatalf("unexpected item: %+v", item)
	}
}

func TestAccountLimit(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want int
		bad  bool
	}{{"", 10000, false}, {"1", 1, false}, {"10000", 10000, false}, {"0", 0, true}, {"01", 0, true}, {"10001", 0, true}} {
		got, err := AccountLimit(tc.raw)
		if tc.bad != (err != nil) || (!tc.bad && got != tc.want) {
			t.Fatalf("raw=%q got=%d err=%v", tc.raw, got, err)
		}
	}
}

func TestBuildRejectsUntrustedCreationBoundaries(t *testing.T) {
	for _, mutate := range []func(*planRPC, *deployment.Manifest, *readmodel.CandidateSet){
		func(_ *planRPC, _ *deployment.Manifest, c *readmodel.CandidateSet) {
			c.Markets[0].Source.BlockHash = "0x" + strings.Repeat("9", 64)
		},
		func(r *planRPC, _ *deployment.Manifest, c *readmodel.CandidateSet) {
			r.codes[c.Markets[0].MemeToken+":"+r.headers["0x9"].Hash] = []byte{9}
		},
		func(_ *planRPC, m *deployment.Manifest, _ *readmodel.CandidateSet) {
			m.Contracts[2].RuntimeCodeHash = "0x" + strings.Repeat("8", 64)
		},
		func(_ *planRPC, _ *deployment.Manifest, c *readmodel.CandidateSet) {
			c.HolderMarkets[0].Distributor = "0x" + strings.Repeat("7", 40)
		},
	} {
		rpc, manifest, candidate := planCase()
		mutate(rpc, &manifest, &candidate)
		if plan, err := Build(t.Context(), rpc, manifest, candidate, 10); !errors.Is(err, ErrPlan) || plan.Version != 0 || plan.Items != nil {
			t.Fatalf("accepted invalid plan: %+v err=%v", plan, err)
		}
	}
}

func TestBuildPreservesEmptyContinuousInventory(t *testing.T) {
	rpc, manifest, candidate := planCase()
	candidate.HolderMarkets = nil
	plan, err := Build(t.Context(), rpc, manifest, candidate, 10)
	if err != nil || plan.Items == nil || len(plan.Items) != 0 {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
}
