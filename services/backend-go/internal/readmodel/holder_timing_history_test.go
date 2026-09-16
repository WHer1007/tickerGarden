package readmodel

import "testing"

func TestHolderTimingHistory(t *testing.T) {
	for _, mode := range []string{"valid", "request early", "publication window", "review delay", "claim window", "empty finalize", "zero policy", "block bound", "conflicting policy", "cancelled attempt", "source valid", "source future", "source distance", "source too early", "cancelled source"} {
		t.Run(mode, func(t *testing.T) {
			e := &EpochHolderCandidate{FinalityDelaySeconds: "10", FinalityDelayBlocks: "1", RootPublicationWindow: "20", RootReviewDelay: "30", ClaimWindow: "40"}
			holders := []HolderMarketCandidate{{Mode: "epoch", Distributor: "d", Epoch: e}}
			h := newHolderClaimHistory()
			h.timingChecks = []holderTimingCheck{{"d", "request", 60, 50, 80}, {"d", "publish", 70, 0, 100}, {"d", "finalize", 110, 0, 150}}
			h.requestSources = []holderRequestSource{{"d", 2, 1, "hash"}}
			switch mode {
			case "source future":
				h.requestSources[0].source = 2
			case "source distance":
				h.requestSources[0].number = 3
			case "source too early":
				h.requestSources[0].number = 1
				h.requestSources[0].source = 0
			case "cancelled source":
				h.requestSources = append(h.requestSources, holderRequestSource{"d", 5, 1, "hash"})
			case "request early":
				h.timingChecks[0].windowEnd = 51
			case "publication window":
				h.timingChecks[0].deadline = 81
			case "review delay":
				h.timingChecks[1].deadline = 101
			case "claim window":
				h.timingChecks[2].deadline = 151
			case "empty finalize":
				h.timingChecks[2].deadline = 0
			case "zero policy":
				e.RootReviewDelay = "0"
			case "block bound":
				e.FinalityDelayBlocks = "256"
			case "conflicting policy":
				other := *e
				other.ClaimWindow = "41"
				holders = append(holders, HolderMarketCandidate{Mode: "epoch", Distributor: "d", Epoch: &other})
			case "cancelled attempt":
				h.timingChecks = append(h.timingChecks, holderTimingCheck{"d", "request", 49, 50, 69})
			}
			valid := mode == "valid" || mode == "empty finalize" || mode == "source valid"
			if err := h.verifyTiming(holders); (err == nil) != valid {
				t.Fatal(mode, err)
			}
		})
	}
}
