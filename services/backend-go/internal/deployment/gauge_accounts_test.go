package deployment

import (
	"context"
	"fmt"
	"testing"
)

func TestGaugeHistoryRefreshesEmptyBlocksAndClassifiesProcessedPending(t *testing.T) {
	for _, processed := range []bool{false, true} {
		f, b, market, user, _ := gaugeFixture(t)
		gauge := market.State["gauge"].(string)
		snapshot := f.calls[gauge+Hash([]byte("activationSnapshot(uint64)"))[:10]+fmt.Sprintf("%064x", 5)]
		snapshot[127] = 0
		if processed {
			snapshot[127] = 1
		}
		account := GaugeAccount{User: user, MarketID: market.MarketID}
		batch, e := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, nil, account, account)
		if e != nil {
			t.Fatal(e)
		}
		if batch.Expected != 3 || len(batch.Observations) != 3 {
			t.Fatal(batch)
		}
		state := batch.Observations[1].Value
		active, pending := "16", "32"
		if processed {
			active, pending = "48", "0"
		}
		if state["knownStoredActiveSum"] != active || state["knownPendingSum"] != pending || state["knownUserCount"] != 1 || state["fullReconciliation"] != false {
			t.Fatal(state)
		}
		if state["checks"].(map[string]bool)["knownActiveSumEqualsStoredTotal"] == processed {
			t.Fatal("incorrect processed pending classification")
		}
		if batch.Observations[2].Value["quoteClaimable"] != "115792089237316195423570985008687907853269984665640564039457584007913129639935" {
			t.Fatal("claim precision lost")
		}
	}
}
func TestGaugeEmptyMarketRefreshAndInvalidHistory(t *testing.T) {
	f, b, market, user, _ := gaugeFixture(t)
	markets := map[string]MarketDiscovery{market.MarketID: market}
	batch, e := ObserveBusinessBlock(context.Background(), f, f.manifest, b, markets, nil)
	if e != nil || batch.Expected != 2 {
		t.Fatal(batch, e)
	}
	for _, account := range []GaugeAccount{{User: zero20, MarketID: market.MarketID}, {User: user, MarketID: zero32}} {
		batch, e = ObserveBusinessBlock(context.Background(), f, f.manifest, b, markets, nil, account)
		if e == nil || len(batch.Observations) != 0 {
			t.Fatal("invalid Gauge history accepted")
		}
	}
}
