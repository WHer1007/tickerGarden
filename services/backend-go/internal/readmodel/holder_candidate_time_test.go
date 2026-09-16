package readmodel

import "testing"

func TestHolderCandidateCanonicalBounds(t *testing.T) {
	zeroAddress := "0x0000000000000000000000000000000000000000"
	zeroHash := "0x0000000000000000000000000000000000000000000000000000000000000000"
	for _, mode := range []string{"continuous", "epoch"} {
		for _, mutation := range []string{"valid", "future", "noncanonical", "missing", "future request", "future activation"} {
			t.Run(mode+"/"+mutation, func(t *testing.T) {
				h := HolderMarketCandidate{Mode: "continuous-24h", Continuous: &ContinuousHolderCandidate{LastFundingAt: "100"}}
				if mode == "epoch" {
					h = HolderMarketCandidate{Mode: "epoch", Epoch: &EpochHolderCandidate{ActivatedAt: "100", EpochDuration: "100", CurrentEpoch: "1", Entries: []HolderEpochDetail{{Epoch: "1", Values: map[string]string{"status": "0", "windowstart": "100", "windowend": "200", "requestedAt": "0", "sourceBlockNumber": "0", "claimUntil": "0", "finalizeAfter": "0", "publishBy": "0", "leafCount": "0", "serviceFeeAmount": "0", "quoteAmount": "0", "claimedAmount": "0", "totalTwab": "0", "requester": zeroAddress, "serviceFeeAsset": zeroAddress, "sourceBlockHash": zeroHash, "merkleRoot": zeroHash, "datasetHash": zeroHash}}}}}
				}
				valid := mutation == "valid"
				switch mutation {
				case "future":
					if mode == "continuous" {
						h.Continuous.LastFundingAt = "101"
					} else {
						h.Epoch.Entries[0].Values["sourceBlockNumber"] = "11"
					}
				case "noncanonical":
					if mode == "continuous" {
						h.Continuous.LastFundingAt = "0100"
					} else {
						h.Epoch.Entries[0].Values["sourceBlockNumber"] = "010"
					}
				case "missing":
					if mode == "continuous" {
						h.Continuous = nil
					} else {
						delete(h.Epoch.Entries[0].Values, "requestedAt")
					}
				case "future request":
					if mode == "epoch" {
						h.Epoch.Entries[0].Values["requestedAt"] = "101"
					} else {
						valid = true
					}
				case "future activation":
					if mode == "epoch" {
						h.Epoch.ActivatedAt = "101"
					} else {
						valid = true
					}
				}
				if e := verifyHolderCandidateTime([]HolderMarketCandidate{h}, 10, 100); (e == nil) != valid {
					t.Fatal(mutation, e)
				}
			})
		}
	}
}
