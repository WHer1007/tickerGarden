package analytics

import (
	"fmt"
	"strconv"
	"testing"
)

func BenchmarkGlobalHolderAggregation(b *testing.B) {
	for _, size := range []struct{ markets, holders int }{{10, 100}, {100, 1000}, {1000, 1000}} {
		for _, overlap := range []bool{true, false} {
			b.Run(fmt.Sprintf("markets=%d/holders=%d/overlap=%t", size.markets, size.holders, overlap), func(b *testing.B) {
				inputs := make([]AssetHolderSnapshot, size.markets)
				for m := range inputs {
					balances := make([]HolderBalance, size.holders)
					for h := range balances {
						n := h + 1
						if !overlap {
							n += m * size.holders
						}
						balances[h] = HolderBalance{Account: fmt.Sprintf("0x%040x", n), BalanceRaw: "1"}
					}
					inputs[m] = AssetHolderSnapshot{AssetUID: fmt.Sprintf("0x%064x", m%10+1), Holders: MarketHolders{MarketID: fmt.Sprintf("0x%064x", m+1), MemeToken: fmt.Sprintf("0x%040x", m+1), CreationBlockNumber: "1", SourceBlockNumber: "10", SourceBlockHash: fmt.Sprintf("0x%064x", 10), Finality: "finalized", ExclusionPolicy: "KNOWN_PROTOCOL_ADDRESSES_V1", HolderBalances: HolderBalances{TotalSupplyRaw: strconv.Itoa(size.holders), PositiveAddressCount: uint64(size.holders), IncludedAddressCount: uint64(size.holders), ExcludedAccounts: []string{}, Balances: balances}}}
				}
				expected := size.markets * size.holders
				if overlap {
					expected = size.holders
				}
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					out, err := AggregateHolderSnapshots("10", inputs[0].Holders.SourceBlockHash, inputs)
					if err != nil || out.PositiveAddressCount != uint64(expected) || out.PositiveMarketAddressPairs != uint64(size.markets*size.holders) {
						b.Fatal(out, err)
					}
				}
			})
		}
	}
}
