package readmodel

import (
	"reflect"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func quoteCandidateFixture(t *testing.T) (deployment.ObservationBatch, SourceBlock, string) {
	b, m := candidateFixture(t, false)
	id := "0x" + strings.Repeat("1", 64)
	zero := "0x" + strings.Repeat("0", 64)
	b.Expected = 1
	b.Observations = []deployment.StateObservation{{Kind: "quote", Key: id, Value: map[string]any{
		"status": "2", "tickerGardenBaselineId": id, "quoteAsset": m.QuoteAsset, "quoteDecimals": "18", "phantomQuote": "900719925474099312345", "graduationThreshold": "100000000000000000000", "economicsHash": id, "runtimeCodeHash": zero, "identityCurrent": false,
		"stockQuoteBinding": map[string]any{"assetUid": zero, "stockTokenFingerprintHash": zero, "referenceEvidenceHash": zero, "generatorPolicyId": zero},
	}}}
	return b, m.Source, id
}
func TestQuoteCandidatePreservesStatusPrecisionAndIdentity(t *testing.T) {
	b, source, id := quoteCandidateFixture(t)
	got, e := BuildConfigCandidate(b, "quote", id, source)
	if e != nil {
		t.Fatal(e)
	}
	if got.Status != 2 || got.Values["quoteDecimals"] != uint64(18) || got.Values["phantomQuote"] != "900719925474099312345" || got.Values["identityCurrent"] != false || got.Source != source {
		t.Fatal(got)
	}
	if _, exists := got.Values["stockQuoteBinding"]; exists {
		t.Fatal("nested object escaped flat API")
	}
	binding := b.Observations[0].Value["stockQuoteBinding"].(map[string]any)
	if got.Values["assetUid"] != binding["assetUid"] {
		t.Fatal("missing binding")
	}
	binding["assetUid"] = id
	if got.Values["assetUid"] == id {
		t.Fatal("mutable input escaped")
	}
}
func TestConfigCandidateRejectsMissingAndMalformed(t *testing.T) {
	for _, mode := range []string{"missing binding", "missing amount", "overflow", "noncanonical", "status", "source", "duplicate", "wrong kind", "object", "chain"} {
		t.Run(mode, func(t *testing.T) {
			b, source, id := quoteCandidateFixture(t)
			kind := "quote"
			v := b.Observations[0].Value
			switch mode {
			case "missing binding":
				delete(v["stockQuoteBinding"].(map[string]any), "assetUid")
			case "missing amount":
				delete(v, "phantomQuote")
			case "overflow":
				v["quoteDecimals"] = "256"
			case "noncanonical":
				v["graduationThreshold"] = "001"
			case "status":
				v["status"] = "0"
			case "source":
				source.BlockHash = id
			case "duplicate":
				b.Observations = append(b.Observations, b.Observations[0])
				b.Expected++
			case "wrong kind":
				kind = "asset"
			case "object":
				v["quoteAsset"] = map[string]any{}
			case "chain":
				source.ChainID++
			}
			got, e := BuildConfigCandidate(b, kind, id, source)
			if e == nil || !reflect.DeepEqual(got, ConfigReadModel{}) {
				t.Fatal("invalid config accepted", got, e)
			}
		})
	}
}
func TestCandidateScalarBoundaries(t *testing.T) {
	for _, tc := range []struct {
		typ, value string
		valid      bool
	}{
		{"uint256", strings.Repeat("9", 78), false}, {"uint256", "900719925474099312345", true}, {"uint256", "-1", false}, {"uint24", "16777215", true}, {"uint24", "16777216", false}, {"int24", "-8388608", true}, {"int24", "8388608", false}, {"int24", "-0", false}, {"address", "0x" + strings.Repeat("A", 40), false},
	} {
		_, ok := candidateScalar(tc.value, tc.typ)
		if ok != tc.valid {
			t.Fatal(tc)
		}
	}
}

func TestBaselineAndTemplateCandidateMappings(t *testing.T) {
	for _, kind := range []string{"baseline", "template"} {
		b, source, id := quoteCandidateFixture(t)
		address := "0x" + strings.Repeat("2", 40)
		value := map[string]any{"status": "3", "referenceChainId": "9007199254740993", "referenceFactory": address, "referenceFactoryCodeHash": id, "launchConfigId": "1", "supply": "1000000000000000000000000000", "curveFeeBps": "100", "poolFee": "3000", "tickSpacing": "-60", "behaviorVectorRoot": id}
		if kind == "template" {
			value = map[string]any{"status": "1", "memeTokenImplementation": address, "memeTokenCodeHash": id, "curveImplementation": address, "curveCodeHash": id, "gaugeImplementation": address, "gaugeCodeHash": id, "graduatedHook": address, "hookCodeHash": id, "graduationExecutor": address, "graduationExecutorCodeHash": id, "feePolicyId": id, "executionSpecId": id, "templateHash": id, "componentCodeIdentityCurrent": false}
		}
		b.Observations[0] = deployment.StateObservation{Kind: kind, Key: id, Value: value}
		got, e := BuildConfigCandidate(b, kind, id, source)
		if e != nil {
			t.Fatal(kind, e)
		}
		if kind == "baseline" && (got.Status != 3 || got.Values["referenceChainId"] != "9007199254740993" || got.Values["tickSpacing"] != int64(-60) || got.Values["poolFee"] != uint64(3000)) {
			t.Fatal(got)
		}
		if kind == "template" && (got.Status != 1 || got.Values["componentCodeIdentityCurrent"] != false || got.Values["graduationExecutor"] != address) {
			t.Fatal(got)
		}
		for field := range value {
			saved := value[field]
			delete(value, field)
			if _, e := BuildConfigCandidate(b, kind, id, source); e == nil {
				t.Fatal(kind, "accepted missing", field)
			}
			value[field] = saved
		}
	}
}

func TestAssetConfigCandidate(t *testing.T) {
	for _, mode := range []string{"valid", "missing minimum", "low minimum", "low decimals", "vault collision", "fingerprint missing"} {
		t.Run(mode, func(t *testing.T) {
			b, source, id := quoteCandidateFixture(t)
			asset := map[string]any{"status": "2", "stockToken": "0x" + strings.Repeat("2", 40), "userStockVault": "0x" + strings.Repeat("3", 40), "tokenDecimals": "18", "minimumAllocation": "414"}
			fingerprint := map[string]any{"tokenRuntimeCodeHash": id, "beacon": "0x" + strings.Repeat("0", 40), "beaconRuntimeCodeHash": id, "implementation": "0x" + strings.Repeat("4", 40), "implementationRuntimeCodeHash": id}
			switch mode {
			case "missing minimum":
				delete(asset, "minimumAllocation")
			case "low minimum":
				asset["minimumAllocation"] = "413"
			case "low decimals":
				asset["tokenDecimals"] = "5"
			case "vault collision":
				asset["userStockVault"] = asset["stockToken"]
			case "fingerprint missing":
				delete(fingerprint, "implementationRuntimeCodeHash")
			}
			b.Observations[0] = deployment.StateObservation{Kind: "asset", Key: id, Value: map[string]any{"asset": asset, "fingerprint": fingerprint, "vaultRuntimeCodeHash": id}}
			got, e := BuildConfigCandidate(b, "asset", id, source)
			if mode != "valid" {
				if e == nil || !reflect.DeepEqual(got, ConfigReadModel{}) {
					t.Fatal("invalid asset accepted", got, e)
				}
				return
			}
			if e != nil || got.Status != 2 || got.Values["minimumAllocation"] != "414" || got.Values["tokenDecimals"] != uint64(18) || got.Values["vaultRuntimeCodeHash"] != id {
				t.Fatal(got, e)
			}
		})
	}
}
