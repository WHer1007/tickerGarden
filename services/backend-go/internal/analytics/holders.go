package analytics

import (
	"errors"
	"math/big"
	"sort"
	"strings"
)

var ErrHolders = errors.New("inconsistent holder history")

type HolderTransfer struct {
	Source CurveSource
	From   string
	To     string
	Value  string
}
type HolderBalance struct {
	Account    string `json:"account"`
	BalanceRaw string `json:"balanceRaw"`
	Excluded   bool   `json:"excluded"`
}
type HolderBalances struct {
	TotalSupplyRaw       string          `json:"totalSupplyRaw"`
	PositiveAddressCount uint64          `json:"positiveAddressCount"`
	IncludedAddressCount uint64          `json:"includedAddressCount"`
	ExcludedAccounts     []string        `json:"excludedAccounts"`
	Balances             []HolderBalance `json:"balances"`
}

// RebuildHolderBalances replays authenticated, complete token history supplied by
// the caller. This pure function cannot establish journal completeness or finality.
// Exclusions affect the included address count only, never the supply or balances.
func RebuildHolderBalances(chain uint64, token, curve, treasury, initialSupply string, transfers []HolderTransfer, exclusions []string) (HolderBalances, error) {
	fail := func() (HolderBalances, error) { return HolderBalances{}, ErrHolders }
	zero := "0x" + strings.Repeat("0", 40)
	for _, a := range []string{token, curve, treasury} {
		if !addressRE.MatchString(a) || a == zero {
			return fail()
		}
	}
	supply, err := uint256(initialSupply)
	if err != nil || supply.Sign() == 0 || chain == 0 || len(transfers) == 0 || len(transfers) > 100000 || len(exclusions) > 1000 {
		return fail()
	}
	excluded := map[string]bool{}
	for _, a := range exclusions {
		if !addressRE.MatchString(a) || a == zero || excluded[a] {
			return fail()
		}
		excluded[a] = true
	}
	type entry struct {
		HolderTransfer
		height *big.Int
		amount *big.Int
	}
	ordered := make([]entry, 0, len(transfers))
	seen := map[string]bool{}
	for _, t := range transfers {
		h, e := uint256(t.Source.BlockNumber)
		v, ve := uint256(t.Value)
		if e != nil || ve != nil || !validSource(t.Source, chain, t.Source.EventKey) || t.Source.Emitter != token || seen[t.Source.EventKey] || !addressRE.MatchString(t.From) || !addressRE.MatchString(t.To) {
			return fail()
		}
		seen[t.Source.EventKey] = true
		ordered = append(ordered, entry{t, h, v})
	}
	sort.Slice(ordered, func(i, j int) bool {
		a, b := ordered[i], ordered[j]
		if c := a.height.Cmp(b.height); c != 0 {
			return c < 0
		}
		if a.Source.TransactionIndex != b.Source.TransactionIndex {
			return a.Source.TransactionIndex < b.Source.TransactionIndex
		}
		return a.Source.LogIndex < b.Source.LogIndex
	})
	balances := map[string]*big.Int{}
	balance := func(a string) *big.Int {
		if balances[a] == nil {
			balances[a] = new(big.Int)
		}
		return balances[a]
	}
	for i, t := range ordered {
		if i > 0 {
			p := ordered[i-1]
			if p.height.Cmp(t.height) == 0 {
				if p.Source.BlockHash != t.Source.BlockHash || p.Source.LogIndex >= t.Source.LogIndex {
					return fail()
				}
				if (p.Source.TransactionIndex == t.Source.TransactionIndex) != (p.Source.TransactionHash == t.Source.TransactionHash) {
					return fail()
				}
			}
		}
		if i == 0 {
			if t.From != zero || t.To != curve || t.amount.Cmp(supply) != 0 {
				return fail()
			}
			balance(curve).Set(supply)
			continue
		}
		if t.From == zero {
			return fail()
		}
		if balance(t.From).Cmp(t.amount) < 0 {
			return fail()
		}
		if t.To == zero {
			if t.From != treasury || t.amount.Sign() == 0 {
				return fail()
			}
			supply.Sub(supply, t.amount)
		}
		balance(t.From).Sub(balance(t.From), t.amount)
		if t.To != zero {
			balance(t.To).Add(balance(t.To), t.amount)
			if balance(t.To).BitLen() > 256 {
				return fail()
			}
		}
	}
	out := HolderBalances{TotalSupplyRaw: supply.String(), ExcludedAccounts: []string{}, Balances: []HolderBalance{}}
	sum := new(big.Int)
	for a, b := range balances {
		sum.Add(sum, b)
		if b.Sign() == 0 {
			continue
		}
		out.PositiveAddressCount++
		if !excluded[a] {
			out.IncludedAddressCount++
		}
		out.Balances = append(out.Balances, HolderBalance{a, b.String(), excluded[a]})
	}
	if sum.Cmp(supply) != 0 {
		return fail()
	}
	for a := range excluded {
		out.ExcludedAccounts = append(out.ExcludedAccounts, a)
	}
	sort.Strings(out.ExcludedAccounts)
	sort.Slice(out.Balances, func(i, j int) bool { return out.Balances[i].Account < out.Balances[j].Account })
	return out, nil
}
