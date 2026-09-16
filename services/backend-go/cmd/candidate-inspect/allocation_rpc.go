package main

import (
	"errors"
	"math/big"
	"strings"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func verifyCandidateAllocationsRPC(c readmodel.CandidateSet, assets map[string]deployment.AssetDiscovery, read func(string, string, string) (*big.Int, error)) error {
	bad := errors.New("candidate market allocation RPC mismatch")
	if len(c.Markets) > 1000 || len(c.Positions) > 10000 {
		return bad
	}
	markets := map[string]readmodel.MarketReadModel{}
	for _, m := range c.Markets {
		if _, exists := markets[m.MarketID]; exists || len(m.MarketID) != 66 {
			return bad
		}
		markets[m.MarketID] = m
	}
	accounts := map[string]readmodel.AccountCandidate{}
	for _, a := range c.Accounts {
		key := a.AssetUID + ":" + a.User
		if _, ok := accounts[key]; ok {
			return bad
		}
		accounts[key] = a
	}
	accountSums, marketSums := map[string]*big.Int{}, map[string]*big.Int{}
	seen := map[string]bool{}
	for _, p := range c.Positions {
		m, ok := markets[p.MarketID]
		if !ok || m.AssetUID != p.AssetUID {
			return bad
		}
		a, ok := assets[p.AssetUID]
		if !ok || len(p.AssetUID) != 66 || len(p.User) != 42 {
			return bad
		}
		accountKey := p.AssetUID + ":" + p.User
		if _, ok := accounts[accountKey]; !ok || seen[accountKey+":"+p.MarketID] {
			return bad
		}
		seen[accountKey+":"+p.MarketID] = true
		n, e := read(a.Vault.Address, "allocation(bytes32,address,bytes32)", p.AssetUID[2:]+strings.Repeat("0", 24)+p.User[2:]+p.MarketID[2:])
		if e != nil || n.String() != p.Allocated {
			return bad
		}
		if accountSums[accountKey] == nil {
			accountSums[accountKey] = new(big.Int)
		}
		accountSums[accountKey].Add(accountSums[accountKey], n)
		if marketSums[p.MarketID] == nil {
			marketSums[p.MarketID] = new(big.Int)
		}
		marketSums[p.MarketID].Add(marketSums[p.MarketID], n)
	}
	for key, a := range accounts {
		sum := accountSums[key]
		if sum == nil {
			sum = new(big.Int)
		}
		if sum.String() != a.Allocated {
			return bad
		}
	}
	for id, m := range markets {
		a, ok := assets[m.AssetUID]
		if !ok {
			if m.AssetUID != "0x"+strings.Repeat("0", 64) {
				return bad
			}
			continue
		} // Only the explicit no-staking asset sentinel may omit a Vault.
		if len(m.AssetUID) != 66 {
			return bad
		}
		n, e := read(a.Vault.Address, "marketAllocated(bytes32,bytes32)", m.AssetUID[2:]+id[2:])
		if e != nil {
			return bad
		}
		sum := marketSums[id]
		if sum == nil {
			sum = new(big.Int)
		}
		if n.Cmp(sum) != 0 {
			return bad
		}
	}
	return nil
}
