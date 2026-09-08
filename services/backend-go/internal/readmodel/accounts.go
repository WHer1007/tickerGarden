package readmodel

import (
	"errors"
	"math/big"
	"strings"
)

func validateAccounts(s Snapshot) error {
	if s.Accounts == nil {
		return nil
	}
	bad := errors.New("invalid account principal coverage")
	assets := map[string]string{}
	for _, c := range s.Configs {
		if c.Kind == "asset" {
			vault, _ := c.Values["userStockVault"].(string)
			assets[c.ID] = vault
		}
	}
	accounts := map[string]UserAccountReadModel{}
	totals := map[string]*big.Int{}
	end, err := Height(*s.Sync.BlockNumber)
	if err != nil {
		return bad
	}
	for _, a := range *s.Accounts {
		key := a.User + ":" + a.AssetUID
		if _, ok := accounts[key]; ok {
			return bad
		}
		at, err := Height(a.Source.BlockNumber)
		if a.Source.TransactionIndex > 1<<53-1 || a.Source.LogIndex > 1<<53-1 || err != nil || at > end || a.Source.ChainID != s.Sync.ChainID || a.User == "0x"+strings.Repeat("0", 40) || a.Vault == "0x"+strings.Repeat("0", 40) || assets[a.AssetUID] != a.Vault {
			return bad
		}
		deposited, e1 := raw(a.Deposited)
		allocated, e2 := raw(a.Allocated)
		free, e3 := raw(a.Free)
		if e1 != nil || e2 != nil || e3 != nil || deposited.String() != a.Deposited || allocated.String() != a.Allocated || free.String() != a.Free || deposited.Cmp(new(big.Int).Add(allocated, free)) != 0 {
			return bad
		}
		accounts[key] = a
		totals[key] = new(big.Int)
	}
	for _, p := range s.Positions {
		key := p.User + ":" + p.AssetUID
		a, ok := accounts[key]
		if !ok || a.Free != p.Free {
			return bad
		}
		n, err := raw(p.Allocated)
		if err != nil {
			return bad
		}
		totals[key].Add(totals[key], n)
	}
	for key, a := range accounts {
		if totals[key].String() != a.Allocated {
			return bad
		}
	}
	return nil
}
