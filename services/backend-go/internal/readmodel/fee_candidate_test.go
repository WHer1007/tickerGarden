package readmodel

import (
	"math/big"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func feeTestAdd(t *testing.T, a, b string) string {
	t.Helper()
	x, ok := new(big.Int).SetString(a, 10)
	if !ok {
		t.Fatal(a)
	}
	y, ok := new(big.Int).SetString(b, 10)
	if !ok {
		t.Fatal(b)
	}
	return x.Add(x, y).String()
}
func TestStoredFeeCoverage(t *testing.T) {
	for _, mode := range []string{"valid", "surplus", "missing liability", "missing solvency", "wrong market", "wrong asset", "wrong vault", "negative", "noncanonical", "overflow", "subtotal", "known total", "total", "underfunded", "staker short", "extra", "duplicate", "false checks"} {
		t.Run(mode, func(t *testing.T) {
			quote := "0x" + strings.Repeat("1", 40)
			meme := "0x" + strings.Repeat("2", 40)
			vault := "0x" + strings.Repeat("3", 40)
			c := CandidateSet{}
			b := deployment.ObservationBatch{}
			unit := "900719925474099312345"
			subtotal := feeTestAdd(t, unit, "4")
			total := feeTestAdd(t, subtotal, subtotal)
			for _, digit := range []string{"4", "5"} {
				id := "0x" + strings.Repeat(digit, 64)
				c.Markets = append(c.Markets, MarketReadModel{MarketID: id, QuoteAsset: quote, MemeToken: meme})
				c.Positions = append(c.Positions, UserPositionReadModel{MarketID: id, Claimable: []Claimable{{Asset: quote, Amount: unit}, {Asset: meme, Amount: unit}}})
				for _, asset := range []string{quote, meme} {
					b.Observations = append(b.Observations, deployment.StateObservation{Kind: "feeLiability", Key: id + ":" + asset, Value: map[string]any{"marketId": id, "feeAsset": asset, "feeVault": vault, "creator": "1", "staker": unit, "platform": "1", "holder": "1", "forfeitureReserve": "1", "bucketAndReserveTotal": subtotal}})
				}
			}
			for _, asset := range []string{quote, meme} {
				b.Observations = append(b.Observations, deployment.StateObservation{Kind: "feeSolvency", Key: asset, Value: map[string]any{"feeAsset": asset, "feeVault": vault, "balance": total, "totalLiability": total, "knownMarketLiabilitySum": total}})
			}
			liability := b.Observations[0].Value
			solvency := b.Observations[4].Value
			switch mode {
			case "surplus":
				solvency["balance"] = feeTestAdd(t, total, "1")
			case "missing liability":
				b.Observations = b.Observations[1:]
			case "missing solvency":
				b.Observations = b.Observations[:5]
			case "wrong market":
				liability["marketId"] = c.Markets[1].MarketID
			case "wrong asset":
				liability["feeAsset"] = meme
			case "wrong vault":
				solvency["feeVault"] = meme
			case "negative":
				liability["holder"] = "-1"
			case "noncanonical":
				liability["platform"] = "01"
			case "overflow":
				liability["creator"] = new(big.Int).Lsh(big.NewInt(1), 256).String()
			case "subtotal":
				liability["bucketAndReserveTotal"] = "0"
			case "known total":
				solvency["knownMarketLiabilitySum"] = "0"
			case "total":
				solvency["totalLiability"] = "0"
			case "underfunded":
				solvency["balance"] = "0"
			case "staker short":
				c.Positions[0].Claimable[0].Amount = feeTestAdd(t, unit, "1")
			case "extra":
				b.Observations = append(b.Observations, deployment.StateObservation{Kind: "feeSolvency", Key: vault})
			case "duplicate":
				b.Observations = append(b.Observations, b.Observations[0])
			case "false checks":
				solvency["checks"] = map[string]bool{"balanceCoversLiability": true}
				solvency["balance"] = "0"
			}
			valid := mode == "valid" || mode == "surplus"
			if e := verifyStoredFeeCoverage(c, b); (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
	if e := verifyStoredFeeCoverage(CandidateSet{}, deployment.ObservationBatch{}); e != nil {
		t.Fatal(e)
	}
}

func TestStoredHolderEpochBuckets(t *testing.T) {
	for _, mode := range []string{"valid", "quote mismatch", "meme mismatch", "split epochs", "overflow", "noncanonical"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x" + strings.Repeat("1", 64)
			q := "0x" + strings.Repeat("2", 40)
			m := "0x" + strings.Repeat("3", 40)
			vault := "0x" + strings.Repeat("4", 40)
			amount := "900719925474099312345"
			values := map[string]string{"holderQuoteLiability": amount, "holderMemeLiability": amount}
			h := HolderMarketCandidate{Mode: "epoch", MarketID: id, QuoteAsset: q, MemeToken: m, Epoch: &EpochHolderCandidate{Entries: []HolderEpochDetail{{Values: values}}}}
			switch mode {
			case "quote mismatch":
				values["holderQuoteLiability"] = feeTestAdd(t, amount, "1")
			case "meme mismatch":
				values["holderMemeLiability"] = "0"
			case "split epochs":
				values["holderQuoteLiability"] = "1"
				h.Epoch.Entries = append(h.Epoch.Entries, HolderEpochDetail{Values: map[string]string{"holderQuoteLiability": "900719925474099312344", "holderMemeLiability": "0"}})
			case "overflow":
				values["holderQuoteLiability"] = new(big.Int).Lsh(big.NewInt(1), 256).String()
			case "noncanonical":
				values["holderMemeLiability"] = "01"
			}
			c := CandidateSet{Markets: []MarketReadModel{{MarketID: id, QuoteAsset: q, MemeToken: m}}, HolderMarkets: []HolderMarketCandidate{h}}
			b := deployment.ObservationBatch{}
			for _, asset := range []string{q, m} {
				b.Observations = append(b.Observations,
					deployment.StateObservation{Kind: "feeLiability", Key: id + ":" + asset, Value: map[string]any{"marketId": id, "feeAsset": asset, "feeVault": vault, "creator": "0", "staker": "0", "platform": "0", "holder": amount, "forfeitureReserve": "0", "bucketAndReserveTotal": amount}},
					deployment.StateObservation{Kind: "feeSolvency", Key: asset, Value: map[string]any{"feeAsset": asset, "feeVault": vault, "totalLiability": amount, "knownMarketLiabilitySum": amount, "balance": amount}})
			}
			valid := mode == "valid" || mode == "split epochs"
			if e := verifyStoredFeeCoverage(c, b); (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
}
