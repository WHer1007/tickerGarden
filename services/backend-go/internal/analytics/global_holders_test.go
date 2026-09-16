package analytics

import (
	"fmt"
	"reflect"
	"testing"
)

func globalHolderFixture() []AssetHolderSnapshot {
	addr := func(n int) string { return fmt.Sprintf("0x%040x", n) }
	hash := func(n int) string { return fmt.Sprintf("0x%064x", n) }
	result := []AssetHolderSnapshot{}
	for i := 0; i < 3; i++ {
		asset := hash(1)
		if i == 2 {
			asset = hash(2)
		}
		h := MarketHolders{MarketID: hash(100 + i), MemeToken: addr(100 + i), CreationBlockNumber: "1", SourceBlockNumber: "10", SourceBlockHash: hash(10), Finality: "finalized", ExclusionPolicy: "KNOWN_PROTOCOL_ADDRESSES_V1", HolderBalances: HolderBalances{TotalSupplyRaw: "30", PositiveAddressCount: 2, IncludedAddressCount: 2, ExcludedAccounts: []string{}, Balances: []HolderBalance{{Account: addr(1), BalanceRaw: "10"}, {Account: addr(2 + i), BalanceRaw: "20"}}}}
		// A known protocol address in market 1 also holds market 2's token.
		if i == 0 {
			h.ExcludedAccounts = []string{addr(3)}
		}
		result = append(result, AssetHolderSnapshot{asset, h})
	}
	return result
}
func TestGlobalHoldersUnionAndExclusions(t *testing.T) {
	in := globalHolderFixture()
	out, e := AggregateHolderSnapshots("10", in[0].Holders.SourceBlockHash, in)
	if e != nil || out.MarketCount != 3 || out.PositiveMarketAddressPairs != 6 || out.PositiveAddressCount != 4 || out.IncludedAddressCount != 3 || len(out.Groups) != 2 {
		t.Fatal(out, e)
	}
	if out.Groups[0].PositiveAddressCount != 3 || out.Groups[0].IncludedAddressCount != 2 || out.Groups[1].PositiveAddressCount != 2 {
		t.Fatal(out)
	}
	in[0], in[2] = in[2], in[0]
	again, e := AggregateHolderSnapshots("10", in[0].Holders.SourceBlockHash, in)
	if e != nil || !reflect.DeepEqual(out, again) {
		t.Fatal("order changed counts", again, e)
	}
}
func TestGlobalHoldersRejectIncompleteOrMixedSnapshots(t *testing.T) {
	for _, mode := range []string{"block", "hash", "duplicateMarket", "duplicateToken", "supply", "count", "flag", "duplicateBalance", "zero"} {
		t.Run(mode, func(t *testing.T) {
			in := globalHolderFixture()
			switch mode {
			case "block":
				in[1].Holders.SourceBlockNumber = "11"
			case "hash":
				in[1].Holders.SourceBlockHash = in[1].Holders.MarketID
			case "duplicateMarket":
				in[1].Holders.MarketID = in[0].Holders.MarketID
			case "duplicateToken":
				in[1].Holders.MemeToken = in[0].Holders.MemeToken
			case "supply":
				in[1].Holders.TotalSupplyRaw = "31"
			case "count":
				in[1].Holders.PositiveAddressCount++
			case "flag":
				in[1].Holders.Balances[0].Excluded = true
			case "duplicateBalance":
				in[1].Holders.Balances[1] = in[1].Holders.Balances[0]
			case "zero":
				in[1].Holders.Balances[0].BalanceRaw = "0"
			}
			if _, e := AggregateHolderSnapshots("10", in[0].Holders.SourceBlockHash, in); e == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}
