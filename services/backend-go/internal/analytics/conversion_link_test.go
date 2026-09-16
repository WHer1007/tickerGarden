package analytics

import (
	"fmt"
	"strings"
	"testing"
)

func conversionLinkFixture(holder, first bool) ([]ConversionLog, ConversionBinding) {
	swap, _, pool := poolFixture(false, first)
	b := ConversionBinding{Pool: pool, Hook: "0x" + strings.Repeat("5", 40), FeeVault: "0x" + strings.Repeat("6", 40), PoolManager: "0x" + strings.Repeat("7", 40)}
	swap.Args["sender"] = b.Hook
	summary := conversionEvent(holder)
	summary.Args["marketId"] = pool.MarketID
	summary.Args["memeAsset"] = pool.MemeAsset
	summary.Args["quoteAsset"] = pool.QuoteAsset
	summary.Args["memeSpent"] = "1000"
	summary.Args["quoteReceived"] = "10000"
	source := CurveSource{ChainID: 4663, BlockNumber: "1", BlockHash: "0x" + strings.Repeat("8", 64), TransactionHash: "0x" + strings.Repeat("9", 64), Emitter: b.PoolManager, LogIndex: 1}
	source.EventKey = fmt.Sprintf("4663:%s:1", source.TransactionHash)
	next := source
	next.LogIndex = 3
	next.Emitter = b.FeeVault
	next.EventKey = fmt.Sprintf("4663:%s:3", source.TransactionHash)
	return []ConversionLog{{Source: source, Event: swap}, {Source: next, Event: summary}}, b
}
func TestConversionLinks(t *testing.T) {
	for _, holder := range []bool{false, true} {
		for _, first := range []bool{false, true} {
			logs, b := conversionLinkFixture(holder, first)
			got, err := LinkConversionSwaps(logs, []ConversionBinding{b})
			if err != nil || len(got) != 1 || got[0].SwapSource != logs[0].Source || got[0].SummarySource != logs[1].Source || got[0].FeeTreatment != "hook_self_call_bypasses_callbacks" {
				t.Fatal(got, err)
			}
		}
	}
}
func TestConversionLinksRejectAmbiguity(t *testing.T) {
	for _, mode := range []string{"amount", "sender", "vault", "manager", "chain", "order", "missing_swap", "missing_summary", "double_swap", "double_summary", "bindings", "fee"} {
		t.Run(mode, func(t *testing.T) {
			logs, b := conversionLinkFixture(false, true)
			bindings := []ConversionBinding{b}
			switch mode {
			case "amount":
				logs[1].Event.Args["quoteReceived"] = "9999"
			case "sender":
				logs[0].Event.Args["sender"] = b.FeeVault
			case "vault":
				logs[1].Source.Emitter = b.Hook
			case "manager":
				logs[0].Source.Emitter = b.Hook
			case "chain":
				logs[1].Source.ChainID = 1
			case "order":
				logs[0], logs[1] = logs[1], logs[0]
			case "missing_swap":
				logs = logs[1:]
			case "missing_summary":
				logs = logs[:1]
			case "double_swap":
				x := logs[0]
				x.Source.LogIndex = 2
				x.Source.EventKey = fmt.Sprintf("4663:%s:2", x.Source.TransactionHash)
				logs = append(logs[:1], x, logs[1])
			case "double_summary":
				x := logs[1]
				x.Source.LogIndex = 4
				x.Source.EventKey = fmt.Sprintf("4663:%s:4", x.Source.TransactionHash)
				logs = append(logs, x)
			case "bindings":
				bindings = append(bindings, b)
			case "fee":
				_, fee, _ := poolFixture(false, true)
				x := logs[0]
				x.Event = fee
				x.Source.Emitter = b.Hook
				x.Source.LogIndex = 2
				x.Source.EventKey = fmt.Sprintf("4663:%s:2", x.Source.TransactionHash)
				logs = append(logs[:1], x, logs[1])
			}
			if got, err := LinkConversionSwaps(logs, bindings); err == nil {
				t.Fatal(mode, got)
			}
		})
	}
}
func TestConversionLinksExcludeRouterAndAllocation(t *testing.T) {
	logs, b := conversionLinkFixture(false, true)
	router := logs[0]
	router.Event.Args = map[string]any{"id": b.Pool.PoolID, "sender": b.FeeVault, "amount0": "-1000", "amount1": "10000", "fee": "0"}
	router.Source.LogIndex = 0
	router.Source.EventKey = fmt.Sprintf("4663:%s:0", router.Source.TransactionHash)
	allocation := logs[1]
	allocation.Source.LogIndex = 2
	allocation.Source.EventKey = fmt.Sprintf("4663:%s:2", allocation.Source.TransactionHash)
	allocation.Event.Signature = "RewardConverted(bytes32,address,uint32,uint256,uint256)"
	logs = []ConversionLog{router, logs[0], allocation, logs[1]}
	got, err := LinkConversionSwaps(logs, []ConversionBinding{b})
	if err != nil || len(got) != 1 || got[0].SwapSource.LogIndex != 1 {
		t.Fatal(got, err)
	}
}

func TestConversionLinksMultipleConversionsSameTransaction(t *testing.T) {
	first, b := conversionLinkFixture(false, true)
	second, _ := conversionLinkFixture(true, true)
	for i := range second {
		second[i].Source.LogIndex += 4
		second[i].Source.EventKey = fmt.Sprintf("4663:%s:%d", second[i].Source.TransactionHash, second[i].Source.LogIndex)
	}
	got, err := LinkConversionSwaps(append(first, second...), []ConversionBinding{b})
	if err != nil || len(got) != 2 || got[0].Activity.Classification != "internal_reward_conversion" || got[1].Activity.Classification != "internal_holder_conversion" || got[0].SwapSource.EventKey == got[1].SwapSource.EventKey {
		t.Fatal(got, err)
	}
}
