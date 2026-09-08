package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"testing"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/treasury"
)

type artifactLookup struct {
	candidate treasury.Candidate
	missing   bool
}

func (a artifactLookup) Find(_ context.Context, chain uint64, market string, epoch uint32, dataset string) (treasury.Candidate, error) {
	if a.missing || a.candidate.Dataset.Context.ChainID != strconv.FormatUint(chain, 10) || a.candidate.Dataset.Context.MarketID != market || a.candidate.Dataset.Context.EpochID != epoch || a.candidate.Dataset.DatasetHash != dataset {
		return treasury.Candidate{}, errors.New("missing artifact")
	}
	return a.candidate, nil
}
func TestCandidateTreasuryArtifacts(t *testing.T) {
	raw, err := os.ReadFile("../../internal/treasury/testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Cases []struct {
			Input treasury.Input `json:"input"`
		} `json:"cases"`
	}
	if json.Unmarshal(raw, &fixtures) != nil || len(fixtures.Cases) == 0 {
		t.Fatal("fixture")
	}
	for i, fixture := range fixtures.Cases {
		for _, mode := range []string{"valid", "missing", "wrong root", "wrong domain", "artifact tampered", "claim tampered", "claim unknown", "claim index", "unreplayed", "missing receipt roots"} {
			t.Run(strconv.Itoa(i)+"/"+mode, func(t *testing.T) {
				output, err := treasury.Generate(fixture.Input)
				if err != nil {
					t.Fatal(err)
				}
				x := output.Context
				chain, _ := strconv.ParseUint(x.ChainID, 10, 64)
				epoch := strconv.FormatUint(uint64(x.EpochID), 10)
				entry := readmodel.HolderEpochDetail{Epoch: epoch, Values: map[string]string{"status": "3", "windowstart": x.WindowStart, "windowend": x.WindowEnd, "sourceBlockNumber": x.SourceBlockNumber, "sourceBlockHash": x.SourceBlockHash, "quoteAmount": fixture.Input.QuoteAmount, "merkleRoot": output.MerkleRoot, "datasetHash": output.DatasetHash, "totalTwab": output.TotalTwab, "leafCount": strconv.FormatUint(uint64(output.LeafCount), 10)}}
				if output.LeafCount == 0 {
					entry.Values["status"] = "4"
				}
				c := readmodel.CandidateSet{ChainID: chain, TreasuryClaimHistoryVerified: true, HolderMarkets: []readmodel.HolderMarketCandidate{{Mode: "epoch", Distributor: x.Distributor, MarketID: x.MarketID, MemeToken: x.MemeToken, QuoteAsset: x.QuoteToken, Epoch: &readmodel.EpochHolderCandidate{EligibilityPolicyHash: x.EligibilityPolicyHash, Entries: []readmodel.HolderEpochDetail{entry}}}}}
				for _, leaf := range output.Leaves {
					c.TreasuryClaims = append(c.TreasuryClaims, readmodel.TreasuryClaimCandidate{Distributor: x.Distributor, MarketID: x.MarketID, Epoch: epoch, LeafIndex: strconv.FormatUint(uint64(leaf.Index), 10), Account: leaf.Account, Twab: leaf.Twab, Amount: leaf.Amount})
				}
				lookup := artifactLookup{candidate: treasury.Candidate{Input: fixture.Input, Dataset: output, Journal: treasury.JournalEvidence{ReceiptRootVerified: true}}}
				switch mode {
				case "missing":
					lookup.missing = true
				case "wrong root":
					entry.Values["merkleRoot"] = x.MarketID
				case "wrong domain":
					c.HolderMarkets[0].Epoch.EligibilityPolicyHash = x.MarketID
				case "artifact tampered":
					lookup.candidate.Dataset.TotalTwab = output.TotalTwab + "0"
				case "missing receipt roots":
					lookup.candidate.Journal.ReceiptRootVerified = false
				case "unreplayed":
					c.TreasuryClaimHistoryVerified = false
				case "claim tampered", "claim unknown", "claim index":
					if len(c.TreasuryClaims) == 0 {
						t.Skip("empty dataset has no claims")
					}
					if mode == "claim tampered" {
						c.TreasuryClaims[0].Amount = "999999"
					}
					if mode == "claim unknown" {
						c.TreasuryClaims[0].Epoch = "999"
					}
					if mode == "claim index" {
						c.TreasuryClaims[0].LeafIndex = "4294967295"
					}
				}
				if err := verifyCandidateTreasuryArtifacts(context.Background(), lookup, c); (err == nil) != (mode == "valid") {
					t.Fatal(mode, err)
				}
			})
		}
	}
}
