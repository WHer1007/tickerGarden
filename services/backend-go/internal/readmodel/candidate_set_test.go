package readmodel

import (
	"reflect"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func fullCandidateFixture(t *testing.T) (deployment.ObservationBatch, map[string]SourceBlock) {
	b, m, _ := positionCandidateFixture(t)
	templateID := "0x" + strings.Repeat("7", 64)
	address := "0x" + strings.Repeat("8", 40)
	b.Observations[0].Value["launchTemplateId"] = templateID
	asset := b.Observations[5].Value
	state := asset["asset"].(map[string]any)
	state["status"] = "1"
	state["stockToken"] = address
	state["tokenDecimals"] = "18"
	state["minimumAllocation"] = "414"
	asset["fingerprint"] = map[string]any{"tokenRuntimeCodeHash": templateID, "beacon": address, "beaconRuntimeCodeHash": templateID, "implementation": address, "implementationRuntimeCodeHash": templateID}
	asset["vaultRuntimeCodeHash"] = templateID
	q, _, _ := quoteCandidateFixture(t)
	quote := q.Observations[0]
	quote.Key = m.QuoteAssetConfigID
	quote.Value["quoteAsset"] = m.QuoteAsset
	quote.Value["tickerGardenBaselineId"] = m.TickerGardenBaselineID
	baseline := deployment.StateObservation{Kind: "baseline", Key: m.TickerGardenBaselineID, Value: map[string]any{"status": "1", "referenceChainId": "46630", "referenceFactory": address, "referenceFactoryCodeHash": templateID, "launchConfigId": "1", "supply": "1000000000000000000000000000", "curveFeeBps": "100", "poolFee": "3000", "tickSpacing": "60", "behaviorVectorRoot": templateID}}
	template := deployment.StateObservation{Kind: "template", Key: templateID, Value: map[string]any{"status": "1", "memeTokenImplementation": address, "memeTokenCodeHash": templateID, "curveImplementation": address, "curveCodeHash": templateID, "gaugeImplementation": address, "gaugeCodeHash": templateID, "graduatedHook": m.CanonicalRoute.Hook, "hookCodeHash": templateID, "graduationExecutor": m.CanonicalRoute.GraduationExecutor, "graduationExecutorCodeHash": templateID, "feePolicyId": templateID, "executionSpecId": templateID, "templateHash": templateID, "componentCodeIdentityCurrent": false}}
	b.Observations = append(b.Observations, quote, baseline, template)
	b.Observations = append(b.Observations, deployment.StateObservation{Kind: "vaultSolvency", Key: m.AssetUID, Value: map[string]any{"assetUid": m.AssetUID, "vault": state["userStockVault"], "stockToken": address, "totalDeposited": "900719925474099312345", "totalAllocated": "1000", "tokenBalance": "900719925474099312345"}})
	b.Expected = len(b.Observations)
	sources := map[string]SourceBlock{}
	for _, o := range b.Observations {
		switch o.Kind {
		case "market":
			sources["market:"+o.Key] = m.Source
		case "asset", "quote", "baseline", "template":
			sources["config:"+o.Kind+":"+o.Key] = m.Source
		case "vaultPosition":
			sources["account:"+o.Key] = m.Source
		case "gaugePosition":
			sources["position:"+o.Key] = m.Source
		}
	}
	return b, sources
}
func TestCandidateSetFullAndDeterministic(t *testing.T) {
	b, sources := fullCandidateFixture(t)
	got, e := BuildCandidateSet(b, sources)
	if e != nil || got.PublicationEligible || len(got.Markets) != 1 || len(got.Configs) != 4 || len(got.Positions) != 1 {
		t.Fatal(got, e)
	}
	for i, j := 0, len(b.Observations)-1; i < j; i, j = i+1, j-1 {
		b.Observations[i], b.Observations[j] = b.Observations[j], b.Observations[i]
	}
	reversed, e := BuildCandidateSet(b, sources)
	if e != nil || !reflect.DeepEqual(got, reversed) {
		t.Fatal("unstable order", e)
	}
}
func TestCandidateSetRejectsIncompleteInventory(t *testing.T) {
	for _, mode := range []string{"source missing", "source extra", "quote mismatch", "baseline missing", "template missing", "template route mismatch", "orphan allocation", "free only account", "position source mismatch"} {
		t.Run(mode, func(t *testing.T) {
			b, s := fullCandidateFixture(t)
			switch mode {
			case "source missing":
				delete(s, "market:"+b.Observations[0].Key)
			case "source extra":
				s["market:unknown"] = SourceBlock{}
			case "quote mismatch":
				b.Observations[9].Value["quoteAsset"] = "0x" + strings.Repeat("9", 40)
			case "baseline missing":
				delete(s, "config:baseline:"+b.Observations[10].Key)
				b.Observations = append(b.Observations[:10], b.Observations[11:]...)
				b.Expected--
			case "template route mismatch":
				b.Observations[11].Value["graduationExecutor"] = "0x" + strings.Repeat("9", 40)
			case "template missing":
				b.Observations[0].Value["launchTemplateId"] = "0x" + strings.Repeat("9", 64)
			case "orphan allocation":
				o := b.Observations[7]
				o.Key += "extra"
				b.Observations = append(b.Observations, o)
				b.Expected++
			case "free only account":
				o := b.Observations[6]
				o.Key += "extra"
				b.Observations = append(b.Observations, o)
				b.Expected++
			case "position source mismatch":
				for k, v := range s {
					if strings.HasPrefix(k, "position:") {
						v.BlockNumber = "2"
						s[k] = v
					}
				}
			}
			got, e := BuildCandidateSet(b, s)
			if e == nil || !reflect.DeepEqual(got, CandidateSet{}) {
				t.Fatal("incomplete set accepted", got, e)
			}
		})
	}
}
