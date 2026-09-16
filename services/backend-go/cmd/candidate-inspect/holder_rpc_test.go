package main

import (
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func TestMatchCandidateHolders(t *testing.T) {
	for _, continuous := range []bool{false, true} {
		for _, mode := range []string{"valid", "missing", "extra", "distributor", "mode", "funding", "time", "scope", "epoch root", "epoch missing", "fee policy", "service treasury", "timing policy"} {
			t.Run(mode+map[bool]string{true: "/stream", false: "/epoch"}[continuous], func(t *testing.T) {
				id := "0x" + strings.Repeat("1", 64)
				token := "0x" + strings.Repeat("2", 40)
				quote := "0x" + strings.Repeat("3", 40)
				m := readmodel.MarketReadModel{MarketID: id, MemeToken: token, QuoteAsset: quote}
				row := map[string]any{"marketId": id, "treasuryDistributor": token, "memeToken": token, "quoteToken": quote, "currentEpochId": "2", "epochDuration": "604800", "currentServiceFeeAsset": quote, "currentServiceFeeAmount": "1", "finalityDelaySeconds": "1", "finalityDelayBlocks": "1", "rootPublicationWindow": "10", "rootReviewDelay": "10", "claimWindow": "100", "rootServiceTreasury": "0x7777777777777777777777777777777777777777", "activatedAt": "100", "eligibilityPolicyHash": id, "twabSchema": id}
				if continuous {
					row = map[string]any{"marketId": id, "treasuryDistributor": token, "rewardMode": "continuous-24h", "token": token, "quote": quote, "streamDuration": "86400", "lastFundingAt": "100", "funded": "900719925474099312345", "paid": "1"}
				}
				b := deployment.ObservationBatch{ChainID: 1, BlockNumber: "0x1", BlockHash: id, Scope: "known-holder-coverage-v1", Expected: 2, Observations: []deployment.StateObservation{{Kind: "market", Key: id, Value: map[string]any{"creatorFeesToHolders": true}}, {Kind: "holderMarket", Key: id, Value: row}}}
				if !continuous {
					b.Observations = append(b.Observations, holderEpochTestRows(id, token, quote)...)
					b.Expected = len(b.Observations)
				}
				holders, e := readmodel.BuildHolderCandidates(b, map[string]readmodel.MarketReadModel{id: m})
				if e != nil {
					t.Fatal(e)
				}
				c := readmodel.CandidateSet{ChainID: 1, BlockNumber: "1", BlockHash: id, Markets: []readmodel.MarketReadModel{m}, HolderMarkets: holders}
				switch mode {
				case "missing":
					c.HolderMarkets = nil
				case "extra":
					c.HolderMarkets = append(c.HolderMarkets, c.HolderMarkets[0])
				case "distributor":
					c.HolderMarkets[0].Distributor = quote
				case "mode":
					c.HolderMarkets[0].Mode = "unknown"
				case "funding":
					if continuous {
						c.HolderMarkets[0].Continuous.Funded = "900719925474099312346"
						c.HolderMarkets[0].Continuous.Paid = "2"
					} else {
						c.HolderMarkets[0].Epoch.CurrentEpoch = "3"
					}
				case "time":
					if continuous {
						c.HolderMarkets[0].Continuous.LastFundingAt = "101"
					} else {
						c.HolderMarkets[0].Epoch.ActivatedAt = "101"
					}
				case "epoch root":
					if continuous {
						c.HolderMarkets[0].Continuous.LastFundingAt = "101"
					} else {
						c.HolderMarkets[0].Epoch.Entries[0].Values["merkleRoot"] = "0x" + strings.Repeat("4", 64)
					}
				case "epoch missing":
					if continuous {
						c.HolderMarkets = nil
					} else {
						c.HolderMarkets[0].Epoch.Entries = c.HolderMarkets[0].Epoch.Entries[:1]
					}
				case "timing policy":
					if continuous {
						c.HolderMarkets = nil
					} else {
						c.HolderMarkets[0].Epoch.RootReviewDelay = "11"
					}
				case "service treasury":
					if continuous {
						c.HolderMarkets = nil
					} else {
						c.HolderMarkets[0].Epoch.RootServiceTreasury = quote
					}
				case "fee policy":
					if continuous {
						c.HolderMarkets = nil
					} else {
						c.HolderMarkets[0].Epoch.CurrentServiceFeeAmount = "2"
					}
				case "scope":
					b.BlockHash = "0x" + strings.Repeat("4", 64)
				}
				if e := matchCandidateHolders(c, b); (e == nil) != (mode == "valid") {
					t.Fatal(mode, e)
				}
			})
		}
	}
}

func holderEpochTestRows(id, token, quote string) []deployment.StateObservation {
	out := []deployment.StateObservation{}
	for _, epoch := range []string{"1", "2"} {
		v := map[string]any{"marketId": id, "epoch": epoch, "treasuryDistributor": token, "quoteAsset": quote, "memeAsset": token, "requester": token, "serviceFeeAsset": quote, "sourceBlockHash": id, "merkleRoot": id, "datasetHash": id, "window": map[string]any{"start": "1", "end": "2"}}
		for _, key := range []string{"requestedAt", "publishBy", "finalizeAfter", "claimUntil", "sourceBlockNumber", "leafCount", "status", "serviceFeeAmount", "quoteAmount", "claimedAmount", "totalTwab", "fundedQuoteAmount", "holderQuoteLiability", "holderMemeLiability", "outstandingQuoteAmount"} {
			v[key] = "0"
		}
		out = append(out, deployment.StateObservation{Kind: "holderEpoch", Key: id + ":" + epoch, Value: v})
	}
	return out
}
