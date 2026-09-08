package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

type candidateScopeRPC struct {
	headers map[string]chainrpc.Header
	codes   map[string][]byte
}

func (*candidateScopeRPC) ChainID(context.Context) (uint64, error) { return 421614, nil }
func (r *candidateScopeRPC) Header(_ context.Context, key string) (chainrpc.Header, error) {
	h, ok := r.headers[key]
	if !ok {
		return chainrpc.Header{}, errors.New("missing header")
	}
	return h, nil
}
func (r *candidateScopeRPC) CodeAt(_ context.Context, address, hash string) ([]byte, error) {
	code, ok := r.codes[address+":"+hash]
	if !ok {
		return nil, errors.New("missing code")
	}
	return code, nil
}

func TestResolveHolderScopesPlansMissingFile(t *testing.T) {
	hash := func(v string) string { return "0x" + strings.Repeat(v, 64) }
	address := func(v string) string { return "0x" + strings.Repeat(v, 40) }
	genesis := chainrpc.Header{Number: "0x0", Hash: hash("1"), ParentHash: hash("0"), Timestamp: "0x0"}
	parent := chainrpc.Header{Number: "0x9", Hash: hash("2"), ParentHash: hash("1"), Timestamp: "0x9"}
	created := chainrpc.Header{Number: "0xa", Hash: hash("3"), ParentHash: parent.Hash, Timestamp: "0xa"}
	finalized := chainrpc.Header{Number: "0xb", Hash: hash("4"), ParentHash: created.Hash, Timestamp: "0xb"}
	factory, vault, distributor, token, quote := address("1"), address("2"), address("3"), address("4"), address("5")
	factoryCode, vaultCode, distributorCode, tokenCode := []byte{1}, []byte{2}, []byte{3}, []byte{4}
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 421614, GenesisHash: genesis.Hash, Contracts: []deployment.Contract{
		{Module: "TickerGardenFactoryV1", Address: factory, RuntimeCodeHash: deployment.Hash(factoryCode)},
		{Module: "ProtocolFeeVault", Address: vault, RuntimeCodeHash: deployment.Hash(vaultCode)},
		{Module: "HolderRewardsDistributorV1", Address: distributor, RuntimeCodeHash: deployment.Hash(distributorCode)},
	}}
	marketID := hash("6")
	candidate := readmodel.CandidateSet{ChainID: manifest.ChainID, BlockNumber: "11", BlockHash: finalized.Hash,
		Markets:       []readmodel.MarketReadModel{{MarketID: marketID, MemeToken: token, QuoteAsset: quote, Source: readmodel.SourceBlock{ChainID: manifest.ChainID, BlockNumber: "10", BlockHash: created.Hash}}},
		HolderMarkets: []readmodel.HolderMarketCandidate{{MarketID: marketID, Distributor: distributor, MemeToken: token, QuoteAsset: quote, Mode: "continuous-24h", Continuous: &readmodel.ContinuousHolderCandidate{}}},
	}
	rpc := &candidateScopeRPC{headers: map[string]chainrpc.Header{"0x0": genesis, "0x9": parent, "0xa": created, "0xb": finalized, "finalized": finalized}, codes: map[string][]byte{
		token + ":" + parent.Hash: {}, token + ":" + created.Hash: tokenCode,
		factory + ":" + created.Hash: factoryCode, vault + ":" + created.Hash: vaultCode, distributor + ":" + created.Hash: distributorCode,
	}}
	env := func(key string) string {
		if key == "TG_HOLDER_MAX_ACCOUNTS" {
			return "99"
		}
		return ""
	}
	scopes, err := resolveHolderScopes(t.Context(), env, rpc, manifest, candidate)
	if err != nil || len(scopes) != 1 || scopes[0].MarketID != marketID || scopes[0].Config.MaxAccounts != 99 || scopes[0].Config.Binding.Vault != vault {
		t.Fatalf("scopes=%+v err=%v", scopes, err)
	}
}
