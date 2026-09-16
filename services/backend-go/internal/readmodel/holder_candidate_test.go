package readmodel

import (
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestHolderMarketCandidates(t *testing.T) {
	for _, continuous := range []bool{false, true} {
		for _, mode := range []string{"valid", "missing", "disabled", "asset", "distributor", "mode", "amount", "time"} {
			t.Run(mode+map[bool]string{true: "/stream", false: "/epoch"}[continuous], func(t *testing.T) {
				id := "0x" + strings.Repeat("1", 64)
				token := "0x" + strings.Repeat("2", 40)
				quote := "0x" + strings.Repeat("3", 40)
				m := MarketReadModel{MarketID: id, MemeToken: token, QuoteAsset: quote}
				v := map[string]any{"marketId": id, "treasuryDistributor": token, "memeToken": token, "quoteToken": quote, "currentEpochId": "2", "epochDuration": "604800", "currentServiceFeeAsset": quote, "currentServiceFeeAmount": "1", "finalityDelaySeconds": "1", "finalityDelayBlocks": "1", "rootPublicationWindow": "10", "rootReviewDelay": "10", "claimWindow": "100", "rootServiceTreasury": "0x7777777777777777777777777777777777777777", "activatedAt": "100", "eligibilityPolicyHash": id, "twabSchema": id}
				if continuous {
					v = map[string]any{"marketId": id, "treasuryDistributor": token, "rewardMode": "continuous-24h", "token": token, "quote": quote, "streamDuration": "86400", "lastFundingAt": "100", "funded": "900719925474099312345", "paid": "1"}
				}
				sharing := true
				switch mode {
				case "disabled":
					sharing = false
				case "asset":
					v["quoteToken"] = token
					v["quote"] = token
				case "distributor":
					v["treasuryDistributor"] = "0x" + strings.Repeat("0", 40)
				case "mode":
					v["rewardMode"] = "unknown"
				case "amount":
					v["paid"] = "900719925474099312346"
					v["currentEpochId"] = "0"
				case "time":
					v["lastFundingAt"] = "0100"
					v["activatedAt"] = "0100"
				}
				b := deployment.ObservationBatch{Observations: []deployment.StateObservation{{Kind: "market", Key: id, Value: map[string]any{"creatorFeesToHolders": sharing}}, {Kind: "holderMarket", Key: id, Value: v}}}
				if !continuous {
					b.Observations = append(b.Observations, holderEpochTestRows(id, token, quote)...)
				}
				if mode == "missing" {
					b.Observations = b.Observations[:1]
				}
				got, e := BuildHolderCandidates(b, map[string]MarketReadModel{id: m})
				if (e == nil) != (mode == "valid") {
					t.Fatal(mode, e)
				}
				if e == nil {
					if len(got) != 1 {
						t.Fatal(got)
					}
					if continuous {
						if got[0].Epoch != nil || got[0].Continuous.Outstanding != "900719925474099312344" {
							t.Fatal(got)
						}
					} else if got[0].Continuous != nil || got[0].Epoch.CurrentEpoch != "2" {
						t.Fatal(got)
					}
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

func TestHolderEpochAccounting(t *testing.T) {
	for _, mode := range []string{"valid", "missing", "duplicate", "overclaimed", "funding", "window", "status", "rolled", "overflow"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x" + strings.Repeat("1", 64)
			token := "0x" + strings.Repeat("2", 40)
			quote := "0x" + strings.Repeat("3", 40)
			rows := holderEpochTestRows(id, token, quote)
			v := rows[0].Value
			switch mode {
			case "missing":
				rows = rows[:1]
			case "duplicate":
				rows = append(rows, rows[0])
			case "overclaimed":
				v["claimedAmount"] = "1"
			case "funding":
				v["status"] = "1"
				v["fundedQuoteAmount"] = "1"
				v["outstandingQuoteAmount"] = "1"
			case "window":
				v["window"] = map[string]any{"start": "2", "end": "1"}
			case "status":
				v["status"] = "5"
			case "rolled":
				v["status"] = "4"
				v["fundedQuoteAmount"] = "1"
			case "overflow":
				v["leafCount"] = "4294967296"
			}
			holders := []HolderMarketCandidate{{MarketID: id, Distributor: token, MemeToken: token, QuoteAsset: quote, Epoch: &EpochHolderCandidate{CurrentEpoch: "2"}}}
			e := holderEpochDetails(deployment.ObservationBatch{Observations: rows}, holders)
			if (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}
