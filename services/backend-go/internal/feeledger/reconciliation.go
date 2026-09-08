package feeledger

import (
	"math/big"
	"sort"

	"tickergarden/backend/internal/deployment"
)

type Probe struct {
	Kind       string  `json:"kind"`
	Key        string  `json:"key"`
	Field      string  `json:"field"`
	Expected   string  `json:"expected"`
	Actual     *string `json:"actual"`
	Comparison string  `json:"comparison"`
	Status     string  `json:"status"`
}
type Report struct {
	Scope                   string   `json:"scope"`
	MatchesKnownLiabilities bool     `json:"matchesKnownLiabilities"`
	HistoryComplete         bool     `json:"historyComplete"`
	PublicationEligible     bool     `json:"publicationEligible"`
	Expected                int      `json:"expected"`
	Completed               int      `json:"completed"`
	Missing                 int      `json:"missing"`
	Failed                  int      `json:"failed"`
	Unexpected              []string `json:"unexpected"`
	Probes                  []Probe  `json:"probes"`
}

// Reconcile plans probes from configured markets and replayed event balances.
// Getter values are observations, never the source of expected amounts. Matching
// cannot establish history completeness, RPC authentication or publication rights.
func (l *Ledger) Reconcile(views []deployment.StateObservation) Report {
	r := Report{Scope: "fee-liabilities-v1", Unexpected: []string{}, Probes: []Probe{}}
	byKey := map[string][]deployment.StateObservation{}
	for _, v := range views {
		if v.Kind == "feeLiability" || v.Kind == "feeSolvency" {
			k := v.Kind + ":" + v.Key
			byKey[k] = append(byKey[k], v)
		}
	}
	consumed := map[string]bool{}
	probe := func(kind, key, field, expected, comparison string, identity map[string]string) {
		k := kind + ":" + key
		consumed[k] = true
		p := Probe{Kind: kind, Key: key, Field: field, Expected: expected, Comparison: comparison, Status: "missing"}
		if matches := byKey[k]; len(matches) == 1 {
			values := matches[0].Value
			valid := true
			for field, want := range identity {
				if values[field] != want {
					valid = false
				}
			}
			actual, ok := values[field].(string)
			if valid && ok && len(actual) <= 78 {
				n, ok := new(big.Int).SetString(actual, 10)
				if ok && n.Sign() >= 0 && n.Cmp(maximum) <= 0 && n.String() == actual {
					p.Actual = &actual
					p.Status = "mismatch"
					r.Completed++
					want, _ := new(big.Int).SetString(expected, 10)
					if actual == expected || (comparison == "atLeast" && n.Cmp(want) >= 0) {
						p.Status = "matched"
					} else {
						r.Failed++
					}
				}
			}
		}
		if p.Status == "missing" {
			r.Missing++
		}
		r.Expected++
		r.Probes = append(r.Probes, p)
	}
	for _, b := range l.Snapshot() {
		key := b.MarketID + ":" + b.Asset
		identity := map[string]string{"marketId": b.MarketID, "feeAsset": b.Asset, "feeVault": l.vault}
		total := new(big.Int)
		for i, field := range []string{"creator", "staker", "platform", "holder", "forfeitureReserve"} {
			probe("feeLiability", key, field, b.Buckets[i], "equal", identity)
			n, _ := new(big.Int).SetString(b.Buckets[i], 10)
			total.Add(total, n)
		}
		probe("feeLiability", key, "bucketAndReserveTotal", total.String(), "equal", identity)
	}
	assets := make([]string, 0, len(l.totals))
	for asset := range l.totals {
		assets = append(assets, asset)
	}
	sort.Strings(assets)
	for _, asset := range assets {
		identity := map[string]string{"feeAsset": asset, "feeVault": l.vault}
		for _, field := range []string{"totalLiability", "knownMarketLiabilitySum", "balance"} {
			comparison := "equal"
			if field == "balance" {
				comparison = "atLeast"
			}
			probe("feeSolvency", asset, field, l.totals[asset].String(), comparison, identity)
		}
	}
	for key := range byKey {
		if !consumed[key] {
			r.Unexpected = append(r.Unexpected, key)
		}
	}
	sort.Strings(r.Unexpected)
	r.MatchesKnownLiabilities = r.Expected > 0 && r.Missing == 0 && r.Failed == 0 && len(r.Unexpected) == 0
	return r
}
