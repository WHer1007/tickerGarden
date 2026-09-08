package main

import (
	"context"
	"errors"
	"math/big"
	"strings"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/readmodel"
)

// Re-read account principal and asset totals at the same canonical hash. This
// covers Vault principal, not Gauge rewards, fees, or Treasury liabilities.
func verifyCandidatePrincipalRPC(ctx context.Context, rpc deployment.BindingObserver, c readmodel.CandidateSet, assets map[string]deployment.AssetDiscovery) error {
	bad := errors.New("candidate Vault principal RPC mismatch")
	if len(c.Accounts) > 10000 {
		return bad
	}
	read := func(address, signature, args string) (*big.Int, error) {
		data, e := rpc.CallAt(ctx, address, deployment.Hash([]byte(signature))[:10]+args, c.BlockHash)
		if e != nil {
			return nil, bad
		}
		values, e := events.DecodeStatic([]events.Input{{Name: "amount", Type: "uint256"}}, data)
		if e != nil {
			return nil, bad
		}
		n, ok := new(big.Int).SetString(values["amount"].(string), 10)
		if !ok {
			return nil, bad
		}
		return n, nil
	}
	type totals struct{ deposited, allocated *big.Int }
	sums := map[string]totals{}
	seen := map[string]bool{}
	for _, account := range c.Accounts {
		asset, ok := assets[account.AssetUID]
		if !ok || asset.Vault.Address != account.Vault || len(account.AssetUID) != 66 || len(account.User) != 42 || seen[account.AssetUID+":"+account.User] {
			return bad
		}
		seen[account.AssetUID+":"+account.User] = true
		args := account.AssetUID[2:] + strings.Repeat("0", 24) + account.User[2:]
		numbers := []*big.Int{}
		for _, field := range []struct{ signature, value string }{{"deposited(bytes32,address)", account.Deposited}, {"allocated(bytes32,address)", account.Allocated}, {"freeBalanceOf(bytes32,address)", account.Free}} {
			n, e := read(account.Vault, field.signature, args)
			if e != nil || n.String() != field.value {
				return bad
			}
			numbers = append(numbers, n)
		}
		if new(big.Int).Add(numbers[1], numbers[2]).Cmp(numbers[0]) != 0 {
			return bad
		}
		sum, ok := sums[account.AssetUID]
		if !ok {
			sum = totals{new(big.Int), new(big.Int)}
		}
		sum.deposited.Add(sum.deposited, numbers[0])
		sum.allocated.Add(sum.allocated, numbers[1])
		sums[account.AssetUID] = sum
	}
	if e := verifyCandidateAllocationsRPC(c, assets, read); e != nil {
		return bad
	}
	for id, asset := range assets {
		if asset.ChainID != c.ChainID || asset.BlockHash != c.BlockHash || asset.AssetUID != id || len(id) != 66 || len(asset.Vault.Address) != 42 {
			return bad
		}
		token, ok := asset.State["stockToken"].(string)
		if !ok {
			return bad
		}
		deposited, e := read(asset.Vault.Address, "totalDeposited(bytes32)", id[2:])
		if e != nil {
			return bad
		}
		allocated, e := read(asset.Vault.Address, "totalAllocated(bytes32)", id[2:])
		if e != nil {
			return bad
		}
		balance, e := read(token, "balanceOf(address)", strings.Repeat("0", 24)+asset.Vault.Address[2:])
		if e != nil {
			return bad
		}
		sum, ok := sums[id]
		if !ok {
			sum = totals{new(big.Int), new(big.Int)}
		}
		if deposited.Cmp(sum.deposited) != 0 || allocated.Cmp(sum.allocated) != 0 || allocated.Cmp(deposited) > 0 || balance.Cmp(deposited) < 0 {
			return bad
		}
	}
	return nil
}
