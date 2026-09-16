package analytics

import (
	"context"
	"math/big"
	"sort"
	"strings"
)

type AssetHolderSnapshot struct {
	AssetUID string
	Holders  MarketHolders
}
type AssetHolderCounts struct {
	AssetUID                   string `json:"assetUid"`
	Binding                    string `json:"binding"`
	MarketCount                uint64 `json:"marketCount"`
	PositiveMarketAddressPairs uint64 `json:"positiveMarketAddressPairs"`
	PositiveAddressCount       uint64 `json:"positiveAddressCount"`
	IncludedAddressCount       uint64 `json:"includedAddressCount"`
}
type GlobalHolderCounts struct {
	SourceBlockNumber          string              `json:"sourceBlockNumber"`
	SourceBlockHash            string              `json:"sourceBlockHash"`
	MarketCount                uint64              `json:"marketCount"`
	PositiveMarketAddressPairs uint64              `json:"positiveMarketAddressPairs"`
	PositiveAddressCount       uint64              `json:"positiveAddressCount"`
	IncludedAddressCount       uint64              `json:"includedAddressCount"`
	ExclusionPolicy            string              `json:"exclusionPolicy"`
	ExcludedAccounts           []string            `json:"excludedAccounts"`
	Groups                     []AssetHolderCounts `json:"groups"`
}

// AggregateHolderSnapshots requires the complete market set with authenticated
// STOCK bindings at one source block. It counts address unions, never sums token
// balances or claims these addresses represent unique people. Exclusions are the
// UNION across all markets, including for per-STOCK adjusted address counts.
func AggregateHolderSnapshots(sourceNumber, sourceHash string, inputs []AssetHolderSnapshot) (GlobalHolderCounts, error) {
	return aggregateHolderSnapshots(context.Background(), sourceNumber, sourceHash, inputs)
}

// HTTP-backed callers carry their deadline into CPU-bound aggregation too.
func aggregateHolderSnapshots(ctx context.Context, sourceNumber, sourceHash string, inputs []AssetHolderSnapshot) (GlobalHolderCounts, error) {
	if err := ctx.Err(); err != nil {
		return GlobalHolderCounts{}, err
	}
	var processed uint64
	checkpoint := func() error {
		processed++
		if processed%256 == 0 {
			return ctx.Err()
		}
		return nil
	}
	fail := func() (GlobalHolderCounts, error) { return GlobalHolderCounts{}, ErrHolders }
	height, err := uint256(sourceNumber)
	if err != nil || !height.IsUint64() || !hashRE.MatchString(sourceHash) || len(inputs) > 1000 {
		return fail()
	}
	zero := "0x" + strings.Repeat("0", 40)
	zeroUID := "0x" + strings.Repeat("0", 64)
	out := GlobalHolderCounts{SourceBlockNumber: sourceNumber, SourceBlockHash: sourceHash, ExclusionPolicy: "UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1", ExcludedAccounts: []string{}, Groups: []AssetHolderCounts{}}
	excluded := map[string]bool{}
	markets := map[string]bool{}
	tokens := map[string]bool{}
	groupAddresses := map[string]map[string]bool{}
	groupCounts := map[string]*AssetHolderCounts{}
	all := map[string]bool{}
	for _, input := range inputs {
		if err := ctx.Err(); err != nil {
			return GlobalHolderCounts{}, err
		}
		h := input.Holders
		if !hashRE.MatchString(input.AssetUID) || !hashRE.MatchString(h.MarketID) || markets[h.MarketID] || !addressRE.MatchString(h.MemeToken) || h.MemeToken == zero || tokens[h.MemeToken] || h.SourceBlockNumber != sourceNumber || h.SourceBlockHash != sourceHash || h.Finality != "finalized" || h.ExclusionPolicy != "KNOWN_PROTOCOL_ADDRESSES_V1" || h.Balances == nil || h.ExcludedAccounts == nil {
			return fail()
		}
		creation, e := uint256(h.CreationBlockNumber)
		if e != nil || creation.Cmp(height) > 0 {
			return fail()
		}
		supply, e := uint256(h.TotalSupplyRaw)
		if e != nil {
			return fail()
		}
		markets[h.MarketID] = true
		tokens[h.MemeToken] = true
		localExclusions := map[string]bool{}
		for _, a := range h.ExcludedAccounts {
			if err := checkpoint(); err != nil {
				return GlobalHolderCounts{}, err
			}
			if !addressRE.MatchString(a) || a == zero || localExclusions[a] {
				return fail()
			}
			localExclusions[a] = true
			excluded[a] = true
		}
		if uint64(len(h.Balances)) != h.PositiveAddressCount || h.IncludedAddressCount > h.PositiveAddressCount || len(h.ExcludedAccounts) > 1000 {
			return fail()
		}
		if out.PositiveMarketAddressPairs+uint64(len(h.Balances)) > 1000000 {
			return fail()
		}
		g := groupCounts[input.AssetUID]
		if g == nil {
			binding := "registered_stock"
			if input.AssetUID == zeroUID {
				binding = "unbound"
			}
			g = &AssetHolderCounts{AssetUID: input.AssetUID, Binding: binding}
			groupCounts[input.AssetUID] = g
			groupAddresses[input.AssetUID] = map[string]bool{}
		}
		g.MarketCount++
		out.MarketCount++
		g.PositiveMarketAddressPairs += uint64(len(h.Balances))
		out.PositiveMarketAddressPairs += uint64(len(h.Balances))
		sum := new(big.Int)
		var included uint64
		last := ""
		var amount big.Int
		addresses := groupAddresses[input.AssetUID]
		for _, b := range h.Balances {
			if err := checkpoint(); err != nil {
				return GlobalHolderCounts{}, err
			}
			e := setUint256(&amount, b.BalanceRaw)
			if e != nil || amount.Sign() == 0 || !addressRE.MatchString(b.Account) || b.Account == zero || b.Account <= last || b.Excluded != localExclusions[b.Account] {
				return fail()
			}
			last = b.Account
			sum.Add(sum, &amount)
			if !b.Excluded {
				included++
			}
			all[b.Account] = true
			addresses[b.Account] = true
		}
		if sum.Cmp(supply) != 0 || included != h.IncludedAddressCount {
			return fail()
		}
	}
	for a := range all {
		if err := checkpoint(); err != nil {
			return GlobalHolderCounts{}, err
		}
		out.PositiveAddressCount++
		if !excluded[a] {
			out.IncludedAddressCount++
		}
	}
	for uid, g := range groupCounts {
		for a := range groupAddresses[uid] {
			if err := checkpoint(); err != nil {
				return GlobalHolderCounts{}, err
			}
			g.PositiveAddressCount++
			if !excluded[a] {
				g.IncludedAddressCount++
			}
		}
		out.Groups = append(out.Groups, *g)
	}
	for a := range excluded {
		if err := checkpoint(); err != nil {
			return GlobalHolderCounts{}, err
		}
		out.ExcludedAccounts = append(out.ExcludedAccounts, a)
	}
	if err := ctx.Err(); err != nil {
		return GlobalHolderCounts{}, err
	}
	sort.Strings(out.ExcludedAccounts)
	sort.Slice(out.Groups, func(i, j int) bool { return out.Groups[i].AssetUID < out.Groups[j].AssetUID })
	if err := ctx.Err(); err != nil {
		return GlobalHolderCounts{}, err
	}
	return out, nil
}
