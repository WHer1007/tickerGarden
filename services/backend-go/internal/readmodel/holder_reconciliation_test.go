package readmodel

import (
	"fmt"
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/feeledger"
)

func TestHolderEpochReconciliation(t *testing.T) {
	for _, mode := range []string{"matched", "epoch shift", "missing epoch", "wrong distributor", "continuous", "no holders", "unexpected holder event", "unexplained debt"} {
		t.Run(mode, func(t *testing.T) {
			c, b, vault, base := feeReconciliationFixture(t)
			m := c.Markets[0]
			distributor := "0x" + strings.Repeat("d", 40)
			c.HolderMarkets = []HolderMarketCandidate{{MarketID: m.MarketID, Distributor: distributor, MemeToken: m.MemeToken, QuoteAsset: m.QuoteAsset, Mode: "epoch", Epoch: &EpochHolderCandidate{Entries: []HolderEpochDetail{{Epoch: "1", Values: map[string]string{"holderQuoteLiability": "5", "holderMemeLiability": "0"}}, {Epoch: "2", Values: map[string]string{"holderQuoteLiability": "0", "holderMemeLiability": "7"}}}}}}
			// Actual HolderFeesAccrued ABI signature and static layout.
			topic := deployment.Hash([]byte("HolderFeesAccrued(bytes32,uint32,address,uint256)"))
			inputs := []feeledger.Input{}
			for i, asset := range []string{m.QuoteAsset, m.MemeToken} {
				log := base[0].Log
				epoch := i + 1
				if mode == "continuous" {
					epoch = 1
				}
				log.LogIndex = fmt.Sprintf("0x%x", i)
				log.Topics = []string{topic, m.MarketID, fmt.Sprintf("0x%064x", epoch), "0x" + strings.Repeat("0", 24) + asset[2:]}
				log.Data = fmt.Sprintf("0x%064x", 5+i*2)
				inputs = append(inputs, feeledger.Input{Module: "ProtocolFeeVault", Log: log})
			}
			for _, o := range b.Observations {
				value := "5"
				if o.Value["feeAsset"] == m.MemeToken {
					value = "7"
				}
				if o.Kind == "feeLiability" {
					o.Value["creator"] = "0"
					o.Value["staker"] = "0"
					o.Value["platform"] = "0"
					o.Value["holder"] = value
					o.Value["bucketAndReserveTotal"] = value
				} else if o.Kind == "feeSolvency" {
					o.Value["totalLiability"] = value
					o.Value["knownMarketLiabilitySum"] = value
					o.Value["balance"] = value
				}
			}
			want := "matched"
			switch mode {
			case "epoch shift":
				c.HolderMarkets[0].Epoch.Entries[0].Values["holderQuoteLiability"] = "4"
				c.HolderMarkets[0].Epoch.Entries[1].Values["holderQuoteLiability"] = "1"
				want = "mismatch"
			case "missing epoch":
				c.HolderMarkets[0].Epoch.Entries = c.HolderMarkets[0].Epoch.Entries[:1]
				want = "unavailable"
			case "wrong distributor":
				c.HolderMarkets[0].Distributor = "bad"
				want = "unavailable"
			case "continuous":
				c.HolderMarkets[0].Mode = "continuous-24h"
				c.HolderMarkets[0].Epoch = nil
			case "no holders":
				for _, o := range b.Observations {
					if o.Kind == "feeLiability" {
						o.Value["holder"] = "0"
					}
				}
				c.HolderMarkets = nil
				inputs = nil
				want = "not_applicable"
			case "unexpected holder event":
				for _, o := range b.Observations {
					if o.Kind == "feeLiability" {
						o.Value["holder"] = "0"
					}
				}
				c.HolderMarkets = nil
				want = "unavailable"
			case "unexplained debt":
				c.HolderMarkets = nil
				inputs = nil
				want = "unavailable"
			}
			got := reconcileHolderEpochs(c, b, vault, inputs)
			if got.Status != want {
				t.Fatal(mode, got)
			}
			if want == "unavailable" && (len(got.Probes) != 0 || got.Reason == "") {
				t.Fatal("partial Holder report", got)
			}
			if mode == "matched" || mode == "continuous" || mode == "epoch shift" {
				result := buildFeeReconciliation(c, b, vault, inputs)
				if result.Status != "matched" || result.HolderEpochs == nil || result.HolderEpochs.Status != want {
					t.Fatal("holder diagnostics lost", result)
				}
				if mode == "matched" || mode == "continuous" {
					c.FeeReconciliation = &result
					testHolderRPC(t, c, vault)
				}
			}
		})
	}
}
