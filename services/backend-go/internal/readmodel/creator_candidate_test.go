package readmodel

import (
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestCreatorCandidateEntitlements(t *testing.T) {
	for _, mode := range []string{"valid", "beneficiary", "amount", "asset", "epoch", "duplicate", "orphan"} {
		t.Run(mode, func(t *testing.T) {
			b, s := fullCandidateFixture(t)
			base, e := BuildCandidateSet(b, s)
			if e != nil {
				t.Fatal(e)
			}
			m := base.Markets[0]
			v := map[string]any{"marketId": m.MarketID, "epoch": "1", "beneficiary": m.MemeToken, "quoteAsset": m.QuoteAsset, "memeAsset": m.MemeToken, "quoteLiability": "900719925474099312345", "memeLiability": "0", "observedAtTimestamp": "100"}
			switch mode {
			case "beneficiary":
				v["beneficiary"] = "0x0000000000000000000000000000000000000000"
			case "amount":
				v["quoteLiability"] = "01"
			case "asset":
				v["quoteAsset"] = m.MemeToken
			case "epoch":
				v["epoch"] = "01"
			case "orphan":
				v["marketId"] = "0x0000000000000000000000000000000000000000000000000000000000000000"
			}
			o := deployment.StateObservation{Kind: "creatorEpoch", Key: m.MarketID + ":1", Value: v}
			b.Observations = append(b.Observations, o)
			for _, a := range []struct{ asset, amount string }{{m.QuoteAsset, "900719925474099312345"}, {m.MemeToken, "0"}} {
				b.Observations = append(b.Observations, deployment.StateObservation{Kind: "feeLiability", Key: m.MarketID + ":" + a.asset, Value: map[string]any{"marketId": m.MarketID, "feeAsset": a.asset, "creatorEpochCount": "1", "creator": a.amount}})
			}
			if mode == "duplicate" {
				b.Observations = append(b.Observations, o)
			}
			b.Expected = len(b.Observations)
			got, e := BuildCandidateSet(b, s)
			if (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
			if e == nil && (len(got.CreatorEpochs) != 1 || got.CreatorEpochs[0].QuoteLiability != "900719925474099312345" || got.PublicationEligible) {
				t.Fatal(got)
			}
		})
	}
}

func TestCreatorCandidateLedgerConsistency(t *testing.T) {
	for _, mode := range []string{"valid", "reversed", "missing first", "missing last", "missing all", "missing bucket", "count", "sum", "timestamp", "observed malformed"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x1111111111111111111111111111111111111111111111111111111111111111"
			quote := "0x2222222222222222222222222222222222222222"
			meme := "0x3333333333333333333333333333333333333333"
			b := deployment.ObservationBatch{}
			for _, epoch := range []string{"1", "2"} {
				b.Observations = append(b.Observations, deployment.StateObservation{Kind: "creatorEpoch", Key: id + ":" + epoch, Value: map[string]any{"marketId": id, "epoch": epoch, "beneficiary": meme, "quoteAsset": quote, "memeAsset": meme, "quoteLiability": epoch, "memeLiability": "0", "observedAtTimestamp": "100"}})
			}
			for _, a := range []struct{ asset, total string }{{quote, "3"}, {meme, "0"}} {
				b.Observations = append(b.Observations, deployment.StateObservation{Kind: "feeLiability", Key: id + ":" + a.asset, Value: map[string]any{"marketId": id, "feeAsset": a.asset, "creatorEpochCount": "2", "creator": a.total}})
			}
			switch mode {
			case "reversed":
				b.Observations[0], b.Observations[1] = b.Observations[1], b.Observations[0]
			case "missing first":
				b.Observations = b.Observations[1:]
			case "missing last":
				b.Observations = append(b.Observations[:1], b.Observations[2:]...)
			case "missing all":
				b.Observations = b.Observations[2:]
			case "missing bucket":
				b.Observations = b.Observations[:3]
			case "count":
				b.Observations[2].Value["creatorEpochCount"] = "1"
			case "sum":
				b.Observations[2].Value["creator"] = "4"
			case "timestamp":
				b.Observations[1].Value["observedAtTimestamp"] = "101"
			case "observed malformed":
				b.Observations[1].Value["observedAtTimestamp"] = "0100"
			}
			got, e := buildCreatorCandidates(b, map[string]MarketReadModel{id: {MarketID: id, QuoteAsset: quote, MemeToken: meme}})
			valid := mode == "valid" || mode == "reversed"
			if (e == nil) != valid {
				t.Fatal(mode, e)
			}
			if valid && (len(got) != 2 || got[0].Epoch != "1" || got[1].Epoch != "2") {
				t.Fatal(got)
			}
		})
	}
}

func TestCreatorCandidateCanonicalTime(t *testing.T) {
	for _, mode := range []string{"valid", "mismatch", "malformed"} {
		t.Run(mode, func(t *testing.T) {
			c := CreatorEpochCandidate{ObservedAtTimestamp: "100"}
			switch mode {
			case "mismatch":
				c.ObservedAtTimestamp = "101"
			case "malformed":
				c.ObservedAtTimestamp = "0100"
			}
			e := verifyCreatorCandidateTime([]CreatorEpochCandidate{c}, 100)
			valid := mode == "valid"
			if (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
}
