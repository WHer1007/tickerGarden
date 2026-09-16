package readmodel

import (
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/feeledger"
)

type EpochLiabilityProbe struct {
	MarketID string `json:"marketId"`
	Epoch    string `json:"epoch"`
	Asset    string `json:"asset"`
	Expected string `json:"expected"`
	Actual   string `json:"actual"`
	Status   string `json:"status"`
}
type CreatorEpochProbe = EpochLiabilityProbe

type CreatorEpochReconciliation struct {
	Status string              `json:"status"`
	Reason string              `json:"reason,omitempty"`
	Probes []CreatorEpochProbe `json:"probes"`
}

// Called only after buildFeeReconciliation validates the same-block candidate
// binding and complete local input inventory/order. This checks epoch amounts,
// not beneficiary ownership, exit timing or independent history authentication.
func reconcileCreatorEpochs(c CandidateSet, vault string, inputs []feeledger.Input) CreatorEpochReconciliation {
	r := CreatorEpochReconciliation{Status: "unavailable", Probes: []CreatorEpochProbe{}}
	fail := func(reason string) CreatorEpochReconciliation { r.Reason = reason; return r }
	if len(c.CreatorEpochs) == 0 || len(c.CreatorEpochs) > deployment.MaxCreatorEpochReads {
		return fail("epoch_inventory_missing")
	}
	configs := make([]feeledger.CreatorEpoch, 0, len(c.CreatorEpochs))
	observed := map[string]string{}
	markets := map[string]MarketReadModel{}
	for _, m := range c.Markets {
		markets[m.MarketID] = m
	}
	for _, e := range c.CreatorEpochs {
		m, ok := markets[e.MarketID]
		if !ok || e.MemeAsset != m.MemeToken || e.QuoteAsset != m.QuoteAsset {
			return fail("epoch_binding_invalid")
		}
		configs = append(configs, feeledger.CreatorEpoch{MarketID: e.MarketID, Epoch: e.Epoch, Meme: e.MemeAsset, Quote: e.QuoteAsset})
		observed[e.MarketID+":"+e.Epoch+":"+e.MemeAsset] = e.MemeLiability
		observed[e.MarketID+":"+e.Epoch+":"+e.QuoteAsset] = e.QuoteLiability
	}
	ledger, err := feeledger.NewCreatorLedger(vault, configs)
	if err != nil {
		return fail("epoch_binding_invalid")
	}
	for start := 0; start < len(inputs); {
		first := inputs[start].Log
		end := start + 1
		for end < len(inputs) && inputs[end].Log.BlockHash == first.BlockHash && inputs[end].Log.TransactionHash == first.TransactionHash {
			end++
		}
		if _, err := ledger.ApplyTransaction(inputs[start:end]); err != nil {
			return fail("epoch_replay_invalid")
		}
		start = end
	}
	r.Status = "matched"
	for _, b := range ledger.Snapshot() {
		actual, ok := observed[b.MarketID+":"+b.Epoch+":"+b.Asset]
		if !ok {
			return CreatorEpochReconciliation{Status: "unavailable", Reason: "epoch_inventory_missing", Probes: []CreatorEpochProbe{}}
		}
		status := "matched"
		if b.Amount != actual {
			status = "mismatch"
			r.Status = "mismatch"
		}
		r.Probes = append(r.Probes, CreatorEpochProbe{MarketID: b.MarketID, Epoch: b.Epoch, Asset: b.Asset, Expected: b.Amount, Actual: actual, Status: status})
	}
	return r
}
