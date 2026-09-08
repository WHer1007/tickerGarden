package readmodel

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCreatorEpochEventEvidence(t *testing.T) {
	c, b, vault, inputs := feeReconciliationFixture(t)
	inputs[0].Log.Topics[2] = "0x" + strings.Repeat("0", 63) + "1"
	m := c.Markets[0]
	c.CreatorEpochs = []CreatorEpochCandidate{{MarketID: m.MarketID, Epoch: "1", QuoteAsset: m.QuoteAsset, MemeAsset: m.MemeToken, QuoteLiability: b.Observations[0].Value["creator"].(string), MemeLiability: "0"}}
	report := buildFeeReconciliation(c, b, vault, inputs)
	c.FeeReconciliation = &report
	if report.CreatorEpochs == nil || report.CreatorEpochs.Status != "matched" || VerifyCreatorEpochEvidence(c) != nil {
		t.Fatal("creator replay", report.CreatorEpochs)
	}
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"missing parent", "missing child", "mismatch", "wrong block", "no history", "duplicate", "missing probe", "extra probe", "wrong expected", "wrong actual", "candidate change", "unavailable replay"} {
		t.Run(mode, func(t *testing.T) {
			var copy CandidateSet
			if json.Unmarshal(raw, &copy) != nil {
				t.Fatal("clone")
			}
			r := copy.FeeReconciliation.CreatorEpochs
			switch mode {
			case "missing parent":
				copy.FeeReconciliation = nil
			case "missing child":
				copy.FeeReconciliation.CreatorEpochs = nil
			case "mismatch":
				r.Status = "mismatch"
			case "wrong block":
				copy.FeeReconciliation.BlockHash = "0x" + strings.Repeat("f", 64)
			case "no history":
				copy.HistoryReceiptRootsVerified = false
			case "duplicate":
				r.Probes[1] = r.Probes[0]
			case "missing probe":
				r.Probes = r.Probes[:1]
			case "extra probe":
				r.Probes = append(r.Probes, r.Probes[0])
			case "wrong expected":
				r.Probes[0].Expected = "999"
			case "wrong actual":
				r.Probes[0].Actual = "999"
			case "candidate change":
				copy.CreatorEpochs[0].MemeLiability = "999"
			case "unavailable replay":
				r.Reason = "epoch_replay_invalid"
			}
			if VerifyCreatorEpochEvidence(copy) == nil {
				t.Fatal("invalid creator evidence accepted")
			}
		})
	}
	c.CreatorEpochs[0].Epoch = "2"
	failed := buildFeeReconciliation(c, b, vault, inputs)
	if failed.CreatorEpochs == nil || failed.CreatorEpochs.Status != "unavailable" || len(failed.CreatorEpochs.Probes) != 0 {
		t.Fatal("unknown event epoch exposed partial report", failed.CreatorEpochs)
	}
}
