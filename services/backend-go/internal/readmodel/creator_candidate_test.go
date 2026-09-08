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
			v := map[string]any{"marketId": m.MarketID, "epoch": "1", "beneficiary": m.MemeToken, "quoteAsset": m.QuoteAsset, "memeAsset": m.MemeToken, "quoteLiability": "900719925474099312345", "memeLiability": "0", "rawRewardExitAt": "0", "observedAtTimestamp": "100", "rawRewardExitReady": false}
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

func TestCreatorExitReady(t *testing.T) {
	for _, tc := range []struct {
		exit, now    string
		ready, valid bool
	}{
		{"0", "100", false, true}, {"101", "100", false, true}, {"100", "100", true, true}, {"99", "100", true, true},
		{"01", "100", false, false}, {"1", "0100", false, false}, {"-1", "100", false, false}, {"1", "18446744073709551616", false, false},
	} {
		got, e := CreatorExitReady(tc.exit, tc.now)
		if (e == nil) != tc.valid || (e == nil && got != tc.ready) {
			t.Fatal(tc, got, e)
		}
	}
}

func TestCreatorCandidateLedgerConsistency(t *testing.T) {
	for _, mode := range []string{"valid", "reversed", "missing first", "missing last", "missing all", "missing bucket", "count", "sum", "timestamp", "exit conflict"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x1111111111111111111111111111111111111111111111111111111111111111"
			quote := "0x2222222222222222222222222222222222222222"
			meme := "0x3333333333333333333333333333333333333333"
			b := deployment.ObservationBatch{}
			for _, epoch := range []string{"1", "2"} {
				b.Observations = append(b.Observations, deployment.StateObservation{Kind: "creatorEpoch", Key: id + ":" + epoch, Value: map[string]any{"marketId": id, "epoch": epoch, "beneficiary": meme, "quoteAsset": quote, "memeAsset": meme, "quoteLiability": epoch, "memeLiability": "0", "rawRewardExitAt": "0", "rawRewardExitReady": false, "observedAtTimestamp": "100"}})
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
			case "exit conflict":
				b.Observations[1].Value["rawRewardExitAt"] = "101"
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
	for _, mode := range []string{"valid", "wrong time", "ready mismatch", "expired", "unrequested", "malformed"} {
		t.Run(mode, func(t *testing.T) {
			c := CreatorEpochCandidate{ObservedAtTimestamp: "100", RawRewardExitAt: "100", RawRewardExitReady: true}
			switch mode {
			case "wrong time":
				c.ObservedAtTimestamp = "101"
			case "ready mismatch":
				c.RawRewardExitReady = false
			case "expired":
				c.RawRewardExitAt = "99"
			case "unrequested":
				c.RawRewardExitAt = "0"
				c.RawRewardExitReady = false
			case "malformed":
				c.RawRewardExitAt = "0100"
			}
			e := verifyCreatorCandidateTime([]CreatorEpochCandidate{c}, 100)
			valid := mode == "valid" || mode == "expired" || mode == "unrequested"
			if (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
}
