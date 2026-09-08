package principal

import "tickergarden/backend/internal/deployment"

// Probe records the planned event value independently of getter availability.
type Probe struct {
	Kind       string  `json:"kind"`
	Key        string  `json:"key"`
	Field      string  `json:"field"`
	Expected   string  `json:"expected"`
	Actual     *string `json:"actual"`
	Status     string  `json:"status"`
	Comparison string  `json:"comparison"`
}

type Reconciliation struct {
	Scope               string  `json:"scope"`
	Expected            int     `json:"expected"`
	Completed           int     `json:"completed"`
	Failed              int     `json:"failed"`
	Missing             int     `json:"missing"`
	HistoryComplete     bool    `json:"historyComplete"`
	PublicationEligible bool    `json:"publicationEligible"`
	Probes              []Probe `json:"probes"`
}

// Reconcile plans every field from the event ledger, never from returned views.
// Missing, duplicate, or malformed getter values do not count as completed.
// Matching known accounts alone cannot establish historical coverage.
func (l *Ledger) Reconcile(views []deployment.StateObservation) Reconciliation {
	r := Reconciliation{Scope: "vault-principal-v3", Probes: []Probe{}}
	byKey := map[string][]map[string]any{}
	for _, view := range views {
		k := view.Kind + ":" + view.Key
		byKey[k] = append(byKey[k], view.Value)
	}
	add := func(kind, key, field, expected, comparison string) {
		p := Probe{Kind: kind, Key: key, Field: field, Expected: expected, Status: "missing", Comparison: comparison}
		matches := byKey[kind+":"+key]
		if len(matches) == 1 {
			if actual, ok := matches[0][field].(string); ok {
				if _, err := integer(actual); err == nil {
					p.Actual = &actual
					p.Status = "mismatch"
					r.Completed++
					if actual == expected || comparison == "atLeast" && value(actual).Cmp(value(expected)) >= 0 {
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
		r.Probes = append(r.Probes, p)
		r.Expected++
	}
	for _, a := range l.Accounts() {
		key := a.AssetUID + ":" + a.User
		add("vaultPosition", key, "deposited", a.Deposited, "equal")
		add("vaultPosition", key, "allocated", a.Allocated, "equal")
		add("vaultPosition", key, "freeBalanceOf", a.Free, "equal")
	}
	for _, a := range l.Allocations() {
		add("vaultAllocation", a.AssetUID+":"+a.User+":"+a.MarketID, "allocation", a.Amount, "equal")
	}
	for _, total := range l.AssetTotals() {
		add("vaultSolvency", total.AssetUID, "totalDeposited", total.Deposited, "equal")
		add("vaultSolvency", total.AssetUID, "totalAllocated", total.Allocated, "equal")
		add("vaultSolvency", total.AssetUID, "tokenBalance", total.Deposited, "atLeast")
	}
	for _, total := range l.MarketTotals() {
		add("vaultMarket", total.AssetUID+":"+total.MarketID, "marketAllocated", total.Allocated, "equal")
	}
	return r
}
