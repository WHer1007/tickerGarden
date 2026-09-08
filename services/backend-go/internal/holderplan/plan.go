// Package holderplan derives authenticated replay scopes from a financial
// candidate, a deployment manifest and hash-pinned chain state.
package holderplan

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/holderledger"
	"tickergarden/backend/internal/readmodel"
)

var ErrPlan = errors.New("continuous Holder replay plan unavailable or inconsistent")

type RPC interface {
	ChainID(context.Context) (uint64, error)
	Header(context.Context, string) (chainrpc.Header, error)
	CodeAt(context.Context, string, string) ([]byte, error)
}

type SeedRequest struct {
	Seed        holderledger.SeedConfig `json:"seed"`
	BlockNumber string                  `json:"blockNumber"`
}

type Item struct {
	MarketID string                       `json:"marketId"`
	Scope    holderledger.CheckpointScope `json:"scope"`
	Seed     SeedRequest                  `json:"seedRequest"`
}

type Plan struct {
	Version              int    `json:"version"`
	ChainID              uint64 `json:"chainId"`
	CandidateBlockNumber string `json:"candidateBlockNumber"`
	CandidateBlockHash   string `json:"candidateBlockHash"`
	Items                []Item `json:"items"`
}

func AccountLimit(raw string) (int, error) {
	if raw == "" {
		return 10000, nil
	}
	n, err := strconv.ParseUint(raw, 10, 14)
	if err != nil || n < 1 || n > 10000 || strconv.FormatUint(n, 10) != raw {
		return 0, errors.New("Holder max accounts must be a canonical integer from 1 to 10000")
	}
	return int(n), nil
}

func contract(manifest deployment.Manifest, module string) (deployment.Contract, error) {
	var result deployment.Contract
	count := 0
	for _, candidate := range manifest.Contracts {
		if candidate.Module == module {
			result = candidate
			count++
		}
	}
	if count != 1 {
		return deployment.Contract{}, ErrPlan
	}
	return result, nil
}

// Build fails closed unless every continuous market maps to the exact static
// deployment bindings and its market source is a finalized, canonical token
// creation boundary. holder-seed repeats the complete authentication before it
// persists anything; this plan is an operator input, not publication evidence.
func Build(ctx context.Context, rpc RPC, manifest deployment.Manifest, candidate readmodel.CandidateSet, maxAccounts int) (Plan, error) {
	fail := func() (Plan, error) { return Plan{}, ErrPlan }
	if rpc == nil || candidate.ChainID != manifest.ChainID || candidate.BlockHash == "" || candidate.BlockNumber == "" || maxAccounts < 1 || maxAccounts > 10000 {
		return fail()
	}
	factory, err := contract(manifest, "TickerGardenFactoryV1")
	if err != nil {
		return fail()
	}
	vault, err := contract(manifest, "ProtocolFeeVault")
	if err != nil {
		return fail()
	}
	distributor, err := contract(manifest, "HolderRewardsDistributorV1")
	if err != nil {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	chainID, err := rpc.ChainID(ctx)
	if err != nil || chainID != manifest.ChainID {
		return fail()
	}
	genesis, err := rpc.Header(ctx, "0x0")
	if err != nil || genesis.Hash != manifest.GenesisHash {
		return fail()
	}
	finalized, err := rpc.Header(ctx, "finalized")
	if err != nil {
		return fail()
	}
	finalizedHeight, err := finalized.Height()
	if err != nil {
		return fail()
	}
	candidateHeight, err := strconv.ParseUint(candidate.BlockNumber, 10, 63)
	if err != nil || strconv.FormatUint(candidateHeight, 10) != candidate.BlockNumber || candidateHeight > finalizedHeight {
		return fail()
	}
	candidateTag := fmt.Sprintf("0x%x", candidateHeight)
	candidateHeader, err := rpc.Header(ctx, candidateTag)
	if err != nil || candidateHeader.Number != candidateTag || strings.ToLower(candidateHeader.Hash) != strings.ToLower(candidate.BlockHash) {
		return fail()
	}
	markets := make(map[string]readmodel.MarketReadModel, len(candidate.Markets))
	for _, market := range candidate.Markets {
		if _, exists := markets[market.MarketID]; exists {
			return fail()
		}
		markets[market.MarketID] = market
	}
	continuous := make([]readmodel.HolderMarketCandidate, 0)
	for _, holder := range candidate.HolderMarkets {
		if holder.Mode == "continuous-24h" {
			continuous = append(continuous, holder)
		}
	}
	sort.Slice(continuous, func(i, j int) bool { return continuous[i].MarketID < continuous[j].MarketID })
	items := make([]Item, 0, len(continuous))
	seen := map[string]bool{}
	for _, holder := range continuous {
		market, ok := markets[holder.MarketID]
		if !ok || seen[holder.MarketID] || holder.Distributor != distributor.Address || holder.MemeToken != market.MemeToken || holder.QuoteAsset != market.QuoteAsset || market.Source.ChainID != manifest.ChainID {
			return fail()
		}
		seen[holder.MarketID] = true
		height, err := strconv.ParseUint(market.Source.BlockNumber, 10, 63)
		if err != nil || strconv.FormatUint(height, 10) != market.Source.BlockNumber || height == 0 || height > candidateHeight {
			return fail()
		}
		tag := fmt.Sprintf("0x%x", height)
		header, err := rpc.Header(ctx, tag)
		if err != nil || header.Number != tag || header.Hash != market.Source.BlockHash {
			return fail()
		}
		parent, err := rpc.Header(ctx, fmt.Sprintf("0x%x", height-1))
		if err != nil || parent.Hash != header.ParentHash {
			return fail()
		}
		priorToken, err := rpc.CodeAt(ctx, holder.MemeToken, parent.Hash)
		if err != nil || len(priorToken) != 0 {
			return fail()
		}
		tokenCode, err := rpc.CodeAt(ctx, holder.MemeToken, header.Hash)
		if err != nil || len(tokenCode) == 0 {
			return fail()
		}
		for _, binding := range []deployment.Contract{factory, vault, distributor} {
			code, codeErr := rpc.CodeAt(ctx, binding.Address, header.Hash)
			if codeErr != nil || len(code) == 0 || deployment.Hash(code) != binding.RuntimeCodeHash {
				return fail()
			}
		}
		scope := holderledger.CheckpointScope{
			MarketID: holder.MarketID,
			Token:    holder.MemeToken,
			Config: holderledger.ReconcileConfig{
				ChainID:             manifest.ChainID,
				GenesisHash:         manifest.GenesisHash,
				Binding:             holderledger.Binding{Distributor: distributor.Address, Vault: vault.Address},
				Quote:               holder.QuoteAsset,
				DistributorCodeHash: distributor.RuntimeCodeHash,
				TokenCodeHash:       deployment.Hash(tokenCode),
				MaxAccounts:         maxAccounts,
			},
		}
		if _, err := holderledger.ScopeDigest(scope); err != nil {
			return fail()
		}
		request := SeedRequest{Seed: holderledger.SeedConfig{Scope: scope, Factory: factory.Address, FactoryCodeHash: factory.RuntimeCodeHash}, BlockNumber: tag}
		items = append(items, Item{MarketID: holder.MarketID, Scope: scope, Seed: request})
	}
	// Recheck the anchors after all code reads so an endpoint cannot move the
	// canonical or finalized view during plan construction.
	chainID, err = rpc.ChainID(ctx)
	if err != nil || chainID != manifest.ChainID {
		return fail()
	}
	genesisAgain, err := rpc.Header(ctx, "0x0")
	if err != nil || genesisAgain != genesis {
		return fail()
	}
	finalizedAgain, err := rpc.Header(ctx, finalized.Number)
	if err != nil || finalizedAgain != finalized || ctx.Err() != nil {
		return fail()
	}
	candidateAgain, err := rpc.Header(ctx, candidateHeader.Number)
	if err != nil || candidateAgain != candidateHeader {
		return fail()
	}
	return Plan{Version: 1, ChainID: manifest.ChainID, CandidateBlockNumber: candidate.BlockNumber, CandidateBlockHash: strings.ToLower(candidate.BlockHash), Items: items}, nil
}
