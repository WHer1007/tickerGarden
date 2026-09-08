package main

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/readmodel"
)

// Reconcile current unpaid Creator epochs. This does not reconstruct paid history
// or prove that the candidate contains every market.
func verifyCandidateCreatorEpochs(ctx context.Context, rpc deployment.BindingObserver, manifest deployment.Manifest, c readmodel.CandidateSet) error {
	bad := errors.New("candidate Creator epoch RPC mismatch")
	if len(c.Markets) > 1000 || len(c.CreatorEpochs) > deployment.MaxCreatorEpochReads {
		return bad
	}
	if len(c.Markets) == 0 {
		if len(c.CreatorEpochs) != 0 {
			return bad
		}
		return nil
	}
	height, e := readmodel.Height(c.BlockNumber)
	if e != nil {
		return bad
	}
	block, e := rpc.Header(ctx, "0x"+strconv.FormatUint(height, 16))
	if e != nil || block.Hash != c.BlockHash || block.Number != "0x"+strconv.FormatUint(height, 16) {
		return bad
	}
	timestamp, e := block.Time()
	if e != nil {
		return bad
	}
	observedAt := strconv.FormatUint(timestamp, 10)
	roots := map[string]string{}
	for _, contract := range manifest.Contracts {
		if roots[contract.Module] != "" {
			return bad
		}
		roots[contract.Module] = contract.Address
	}
	zero := "0x" + strings.Repeat("0", 40)
	for _, module := range []string{"ProtocolFeeVault", "TickerGardenFactoryV1", "MarketRegistryV1"} {
		if len(roots[module]) != 42 || roots[module] == zero {
			return bad
		}
	}
	read := func(address, sig, args, typ string) (string, error) {
		raw, e := rpc.CallAt(ctx, address, deployment.Hash([]byte(sig))[:10]+args, c.BlockHash)
		if e != nil {
			return "", bad
		}
		v, e := events.DecodeStatic([]events.Input{{Name: "value", Type: typ}}, raw)
		if e != nil {
			return "", bad
		}
		return v["value"].(string), nil
	}
	vault := roots["ProtocolFeeVault"]
	creator, e := read(vault, "creatorRevenueRegistry()", "", "address")
	if e != nil || creator == zero {
		return bad
	}
	if expected := roots["CreatorRevenueRegistry"]; expected != "" && expected != creator {
		return bad
	}
	code, e := rpc.CodeAt(ctx, creator, c.BlockHash)
	if e != nil || len(code) == 0 {
		return bad
	}
	for _, edge := range []struct{ address, sig, module string }{
		{vault, "marketRegistry()", "MarketRegistryV1"},
		{creator, "marketRegistry()", "MarketRegistryV1"},
		{creator, "factory()", "TickerGardenFactoryV1"},
	} {
		got, e := read(edge.address, edge.sig, "", "address")
		if e != nil || got != roots[edge.module] {
			return bad
		}
	}
	entitlements := map[string]readmodel.CreatorEpochCandidate{}
	for _, epoch := range c.CreatorEpochs {
		key := epoch.MarketID + ":" + epoch.Epoch
		if _, ok := entitlements[key]; ok {
			return bad
		}
		entitlements[key] = epoch
	}
	remaining := uint64(deployment.MaxCreatorEpochReads)
	seen := map[string]bool{}
	for _, market := range c.Markets {
		if len(market.MarketID) != 66 || seen[market.MarketID] || len(market.QuoteAsset) != 42 || len(market.MemeToken) != 42 || market.MemeToken == zero || market.QuoteAsset == market.MemeToken {
			return bad
		}
		seen[market.MarketID] = true
		countRaw, e := read(creator, "currentCreatorEpoch(bytes32)", market.MarketID[2:], "uint32")
		if e != nil {
			return bad
		}
		count, e := strconv.ParseUint(countRaw, 10, 32)
		if e != nil || count == 0 || count > remaining {
			return bad
		}
		remaining -= count
		sums := [2]*big.Int{new(big.Int), new(big.Int)}
		assets := []string{market.QuoteAsset, market.MemeToken}
		for epoch := uint64(1); epoch <= count; epoch++ {
			args := market.MarketID[2:] + fmt.Sprintf("%064x", epoch)
			beneficiary, e := read(creator, "creatorBeneficiaryAt(bytes32,uint32)", args, "address")
			if e != nil || beneficiary == zero {
				return bad
			}
			key := market.MarketID + ":" + strconv.FormatUint(epoch, 10)
			expected, ok := entitlements[key]
			if !ok || expected.Beneficiary != beneficiary || expected.QuoteAsset != market.QuoteAsset || expected.MemeAsset != market.MemeToken {
				return bad
			}
			exitAt, e := read(vault, "rawRewardExitAt(bytes32,address)", market.MarketID[2:]+strings.Repeat("0", 24)+beneficiary[2:], "uint256")
			ready, readyErr := readmodel.CreatorExitReady(exitAt, observedAt)
			if e != nil || readyErr != nil || expected.RawRewardExitAt != exitAt || expected.ObservedAtTimestamp != observedAt || expected.RawRewardExitReady != ready {
				return bad
			}
			delete(entitlements, key)
			for i, asset := range assets {
				raw, e := read(vault, "creatorLiability(bytes32,uint32,address)", args+strings.Repeat("0", 24)+asset[2:], "uint256")
				if e != nil {
					return bad
				}
				want := expected.QuoteLiability
				if i == 1 {
					want = expected.MemeLiability
				}
				if raw != want {
					return bad
				}
				n, _ := new(big.Int).SetString(raw, 10)
				sums[i].Add(sums[i], n)
				if sums[i].BitLen() > 256 {
					return bad
				}
			}
		}
		for i, asset := range assets {
			raw, e := read(vault, "liability(bytes32,address,uint8)", market.MarketID[2:]+strings.Repeat("0", 24)+asset[2:]+strings.Repeat("0", 64), "uint256")
			if e != nil || raw != sums[i].String() {
				return bad
			}
		}
	}
	if len(entitlements) != 0 {
		return bad
	}
	return nil
}
