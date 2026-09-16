package main

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"reflect"
	"strconv"
	"strings"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/readmodel"
)

func verifyCandidateGauges(ctx context.Context, rpc deployment.BindingObserver, manifest deployment.Manifest, c readmodel.CandidateSet) error {
	bad := errors.New("candidate Gauge position RPC mismatch")
	if len(c.Positions) > 10000 || len(c.Markets) > 1000 {
		return bad
	}
	roots := map[string]string{}
	for _, contract := range manifest.Contracts {
		if contract.Module == "AllocationManager" || contract.Module == "ProtocolFeeVault" {
			if roots[contract.Module] != "" {
				return bad
			}
			roots[contract.Module] = contract.Address
		}
	}
	markets := map[string]readmodel.MarketReadModel{}
	for _, m := range c.Markets {
		if _, ok := markets[m.MarketID]; ok {
			return bad
		}
		markets[m.MarketID] = m
	}
	read := func(address, signature, args string, fields []events.Input) (map[string]any, error) {
		raw, e := rpc.CallAt(ctx, address, deployment.Hash([]byte(signature))[:10]+args, c.BlockHash)
		if e != nil {
			return nil, bad
		}
		return events.DecodeStatic(fields, raw)
	}
	checkIdentity := func(m readmodel.MarketReadModel) error {
		code, e := rpc.CodeAt(ctx, m.Gauge, c.BlockHash)
		if e != nil || len(code) == 0 {
			return bad
		}
		fields := []events.Input{{Name: "marketId", Type: "bytes32"}, {Name: "assetUid", Type: "bytes32"}, {Name: "quoteAssetConfigId", Type: "bytes32"}, {Name: "allocationManager", Type: "address"}, {Name: "protocolFeeVault", Type: "address"}, {Name: "quoteAsset", Type: "address"}, {Name: "memeToken", Type: "address"}}
		identity, e := read(m.Gauge, "gaugeIdentity()", "", fields)
		if e != nil {
			return bad
		}
		for key, want := range map[string]string{"marketId": m.MarketID, "assetUid": m.AssetUID, "quoteAssetConfigId": m.QuoteAssetConfigID, "allocationManager": roots["AllocationManager"], "protocolFeeVault": roots["ProtocolFeeVault"], "quoteAsset": m.QuoteAsset, "memeToken": m.MemeToken} {
			if identity[key] != want {
				return bad
			}
		}

		return nil
	}
	checked := map[string]bool{}
	totals := map[string][2]*big.Int{}
	gauges := map[string]bool{}
	for _, m := range c.Markets {
		if m.Gauge == "0x"+strings.Repeat("0", 40) {
			continue
		}
		if gauges[m.Gauge] {
			return bad
		}
		gauges[m.Gauge] = true
		if checkIdentity(m) != nil {
			return bad
		}
		checked[m.MarketID] = true
		totals[m.MarketID] = [2]*big.Int{new(big.Int), new(big.Int)}
	}
	seenPositions := map[string]bool{}

	for _, p := range c.Positions {
		m, ok := markets[p.MarketID]
		if !ok || !checked[m.MarketID] || seenPositions[p.MarketID+":"+p.User] || m.AssetUID != p.AssetUID || len(p.User) != 42 || len(p.MarketID) != 66 || roots["AllocationManager"] == "" || roots["ProtocolFeeVault"] == "" {
			return bad
		}

		seenPositions[p.MarketID+":"+p.User] = true
		args := strings.Repeat("0", 24) + p.User[2:]
		fields := []events.Input{{Name: "activeAmount", Type: "uint256"}, {Name: "pendingAmount", Type: "uint256"}, {Name: "pendingGeneration", Type: "uint64"}, {Name: "unlockAt", Type: "uint64"}, {Name: "quoteClaimable", Type: "uint256"}, {Name: "memeClaimable", Type: "uint256"}}
		position, e := read(m.Gauge, "positionOf(address)", args, fields)
		if e != nil {
			return bad
		}
		settlement, e := read(roots["AllocationManager"], "rageQuitSettlementPending(bytes32,address)", m.MarketID[2:]+args, []events.Input{{Name: "pending", Type: "bool"}, {Name: "principal", Type: "uint256"}})
		if e != nil || settlement["pending"] != false || settlement["principal"] != "0" {
			return bad
		}
		var snapshot any
		if position["pendingAmount"] != "0" {
			generation, e := strconv.ParseUint(position["pendingGeneration"].(string), 10, 64)
			if e != nil {
				return bad
			}
			snapshot, e = read(m.Gauge, "activationSnapshot(uint64)", fmt.Sprintf("%064x", generation), []events.Input{{Name: "quoteAccumulator", Type: "uint256"}, {Name: "memeAccumulator", Type: "uint256"}, {Name: "refs", Type: "uint256"}, {Name: "processed", Type: "bool"}})
			if e != nil {
				return bad
			}
		}
		normalized, e := readmodel.NormalizeGaugePrincipal(position["activeAmount"].(string), position["pendingAmount"].(string), position["pendingGeneration"], position["unlockAt"], snapshot)
		if e != nil || normalized.Active != p.Active || normalized.Pending != p.Pending || !reflect.DeepEqual(normalized.ActivationAt, p.ActivationAt) || !reflect.DeepEqual(normalized.UnlockAt, p.UnlockAt) {
			return bad
		}
		active, _ := new(big.Int).SetString(normalized.Active, 10)
		pending, _ := new(big.Int).SetString(normalized.Pending, 10)
		sum := totals[m.MarketID]
		sum[0].Add(sum[0], active)
		sum[1].Add(sum[1], pending)
		if new(big.Int).Add(active, pending).String() != p.Allocated {
			return bad
		}
		want := []readmodel.Claimable{{Kind: "quote", Asset: m.QuoteAsset, Amount: position["quoteClaimable"].(string)}, {Kind: "meme", Asset: m.MemeToken, Amount: position["memeClaimable"].(string)}}
		if !reflect.DeepEqual(p.Claimable, want) {
			return bad
		}
	}
	for id, sum := range totals {
		for i, signature := range []string{"storedTotalActiveStock()", "totalPendingStock()"} {
			value, e := read(markets[id].Gauge, signature, "", []events.Input{{Name: "amount", Type: "uint256"}})
			if e != nil || value["amount"] != sum[i].String() {
				return bad
			}
		}
	}
	return nil
}
