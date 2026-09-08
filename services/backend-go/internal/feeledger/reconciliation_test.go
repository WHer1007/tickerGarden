package feeledger

import (
	"math/big"
	"reflect"
	"testing"

	"tickergarden/backend/internal/deployment"
)

func feeViews(l *Ledger) []deployment.StateObservation {
	out := []deployment.StateObservation{}
	for _, b := range l.Snapshot() {
		values := map[string]any{"marketId": b.MarketID, "feeAsset": b.Asset, "feeVault": vault}
		total := new(big.Int)
		for i, f := range []string{"creator", "staker", "platform", "holder", "forfeitureReserve"} {
			values[f] = b.Buckets[i]
			n, _ := new(big.Int).SetString(b.Buckets[i], 10)
			total.Add(total, n)
		}
		values["bucketAndReserveTotal"] = total.String()
		out = append(out, deployment.StateObservation{Kind: "feeLiability", Key: b.MarketID + ":" + b.Asset, Value: values})
	}
	for asset, total := range l.totals {
		out = append(out, deployment.StateObservation{Kind: "feeSolvency", Key: asset, Value: map[string]any{"feeAsset": asset, "feeVault": vault, "totalLiability": total.String(), "knownMarketLiabilitySum": total.String(), "balance": total.String()}})
	}
	return out
}
func TestFeeReconciliationCoverage(t *testing.T) {
	for _, mode := range []string{"matched", "excess balance", "deficit", "mismatch", "missing", "duplicate", "extra", "wrong vault", "malformed"} {
		t.Run(mode, func(t *testing.T) {
			l := newLedger(t)
			apply(t, l, "FeeBucketsCredited", map[string]any{"feeAsset": market.Meme, "creatorAmount": "9007199254740993", "stakerAmount": "2", "platformAmount": "3"})
			views := feeViews(l)
			switch mode {
			case "excess balance", "deficit":
				for _, v := range views {
					if v.Kind == "feeSolvency" && v.Key == market.Meme {
						v.Value["balance"] = "9007199254741093"
						if mode == "deficit" {
							v.Value["balance"] = "0"
						}
					}
				}
			case "mismatch":
				views[0].Value["creator"] = "999"
			case "missing":
				views = views[1:]
			case "duplicate":
				views = append(views, views[0])
			case "extra":
				views = append(views, deployment.StateObservation{Kind: "feeLiability", Key: "unknown", Value: map[string]any{}})
			case "wrong vault":
				views[0].Value["feeVault"] = market.Distributor
			case "malformed":
				views[0].Value["creator"] = "01"
			}
			r := l.Reconcile(views)
			valid := mode == "matched" || mode == "excess balance"
			if r.MatchesKnownLiabilities != valid || r.HistoryComplete || r.PublicationEligible || r.Expected != 18 || r.Completed+r.Missing != r.Expected {
				t.Fatal(mode, r)
			}
			for i, j := 0, len(views)-1; i < j; i, j = i+1, j-1 {
				views[i], views[j] = views[j], views[i]
			}
			if !reflect.DeepEqual(r, l.Reconcile(views)) {
				t.Fatal("unstable reconciliation order")
			}
		})
	}
}

func TestFeeReconciliationDoesNotTreatEmptyInventoryAsVerified(t *testing.T) {
	l, err := New(vault, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := l.Reconcile(nil)
	if r.MatchesKnownLiabilities || r.Expected != 0 || r.Completed != 0 || r.Missing != 0 || r.Failed != 0 || len(r.Probes) != 0 || len(r.Unexpected) != 0 {
		t.Fatal("empty inventory was treated as verified financial evidence", r)
	}
}
