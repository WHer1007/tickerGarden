package main

import (
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func TestCandidateConfigurationRPCMatch(t *testing.T) {
	for _, mode := range []string{"valid", "amount", "status", "missing", "extra", "identity", "source"} {
		t.Run(mode, func(t *testing.T) {
			hash := "0x" + strings.Repeat("1", 64)
			address := "0x" + strings.Repeat("2", 40)
			values := map[string]any{"status": "1", "tickerGardenBaselineId": hash, "quoteAsset": address, "quoteDecimals": "18", "phantomQuote": "900719925474099312345", "graduationThreshold": "1000", "economicsHash": hash, "runtimeCodeHash": hash, "identityCurrent": false, "stockQuoteBinding": map[string]any{"assetUid": hash, "stockTokenFingerprintHash": hash, "referenceEvidenceHash": hash, "generatorPolicyId": hash}}
			b := deployment.ObservationBatch{Scope: deployment.ConfigObservationScope, ChainID: 46630, BlockNumber: "0xa", BlockHash: hash, Expected: 1, Observations: []deployment.StateObservation{{Kind: "quote", Key: hash, Value: values}}}
			source := readmodel.SourceBlock{ChainID: 46630, BlockNumber: "10", BlockHash: hash, TransactionHash: hash}
			config, e := readmodel.BuildConfigCandidate(b, "quote", hash, source)
			if e != nil {
				t.Fatal(e)
			}
			switch mode {
			case "amount":
				values["phantomQuote"] = "900719925474099312346"
			case "status":
				values["status"] = "2"
			case "missing":
				b.Observations = nil
				b.Expected = 0
			case "extra":
				b.Observations = append(b.Observations, b.Observations[0])
				b.Expected++
			case "identity":
				values["identityCurrent"] = true
			case "source":
				config.Source.BlockHash = "0x" + strings.Repeat("3", 64)
			}
			if e := matchCandidateConfigs([]readmodel.ConfigReadModel{config}, b); (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}
