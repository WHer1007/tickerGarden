package readmodel

import (
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/feeledger"
)

type HolderEpochReconciliation struct {
	Status string                `json:"status"`
	Reason string                `json:"reason,omitempty"`
	Probes []EpochLiabilityProbe `json:"probes"`
}

// The enclosing fee reconciliation has already checked candidate/block binding
// and canonical local transaction inventory. Continuous distribution has exactly
// one accounting epoch; its remaining FeeVault debt comes from the Holder bucket,
// not the distributor's funded-minus-paid balance.
func reconcileHolderEpochs(c CandidateSet, batch deployment.ObservationBatch, vault string, inputs []feeledger.Input) HolderEpochReconciliation {
	r := HolderEpochReconciliation{Status: "unavailable", Probes: []EpochLiabilityProbe{}}
	fail := func(reason string) HolderEpochReconciliation { r.Reason = reason; return r }
	markets := map[string]MarketReadModel{}
	for _, m := range c.Markets {
		markets[m.MarketID] = m
	}
	rows := map[string]deployment.StateObservation{}
	for _, o := range batch.Observations {
		if o.Kind == "feeLiability" {
			if _, ok := rows[o.Key]; ok {
				return fail("holder_observation_invalid")
			}
			rows[o.Key] = o
		}
	}
	configs := []feeledger.HolderEpoch{}
	observed := map[string]string{}
	seen := map[string]bool{}
	for _, h := range c.HolderMarkets {
		m, ok := markets[h.MarketID]
		if !ok || seen[h.MarketID] || m.MemeToken != h.MemeToken || m.QuoteAsset != h.QuoteAsset {
			return fail("holder_binding_invalid")
		}
		seen[h.MarketID] = true
		module := "TreasuryDistributorV1"
		entries := []HolderEpochDetail{}
		switch h.Mode {
		case "epoch":
			if h.Epoch == nil || len(h.Epoch.Entries) == 0 {
				return fail("holder_epoch_inventory_missing")
			}
			entries = h.Epoch.Entries
		case "continuous-24h":
			module = "HolderRewardsDistributorV1"
			values := map[string]string{}
			for _, pair := range [][2]string{{h.QuoteAsset, "holderQuoteLiability"}, {h.MemeToken, "holderMemeLiability"}} {
				row, ok := rows[h.MarketID+":"+pair[0]]
				if !ok || row.Value["feeVault"] != vault || row.Value["marketId"] != h.MarketID || row.Value["feeAsset"] != pair[0] {
					return fail("holder_observation_invalid")
				}
				value, ok := row.Value["holder"].(string)
				if !ok {
					return fail("holder_observation_invalid")
				}
				values[pair[1]] = value
			}
			entries = []HolderEpochDetail{{Epoch: "1", Values: values}}
		default:
			return fail("holder_binding_invalid")
		}
		for _, e := range entries {
			if len(configs) >= deployment.MaxHolderEpochReads {
				return fail("holder_epoch_budget_exceeded")
			}
			configs = append(configs, feeledger.HolderEpoch{MarketID: h.MarketID, Epoch: e.Epoch, Meme: h.MemeToken, Quote: h.QuoteAsset, Distributor: h.Distributor, DistributorModule: module})
			for _, pair := range [][2]string{{h.QuoteAsset, "holderQuoteLiability"}, {h.MemeToken, "holderMemeLiability"}} {
				value := e.Values[pair[1]]
				if len(value) > 78 {
					return fail("holder_observation_invalid")
				}
				n, err := raw(value)
				if len(value) > 78 || err != nil || n.String() != value {
					return fail("holder_observation_invalid")
				}
				observed[h.MarketID+":"+e.Epoch+":"+pair[0]] = value
			}
		}
	}
	for _, row := range rows {
		id, _ := row.Value["marketId"].(string)
		if !seen[id] && row.Value["holder"] != "0" {
			return fail("holder_inventory_missing")
		}
	}
	ledger, err := feeledger.NewHolderLedger(vault, configs)
	if err != nil {
		return fail("holder_binding_invalid")
	}
	for start := 0; start < len(inputs); {
		first := inputs[start].Log
		end := start + 1
		for end < len(inputs) && inputs[end].Log.BlockHash == first.BlockHash && inputs[end].Log.TransactionHash == first.TransactionHash {
			end++
		}
		if _, err := ledger.ApplyTransaction(inputs[start:end]); err != nil {
			return fail("holder_epoch_replay_invalid")
		}
		start = end
	}
	r.Status = "matched"
	if len(configs) == 0 {
		r.Status = "not_applicable"
		return r
	}
	for _, b := range ledger.Snapshot() {
		actual := observed[b.MarketID+":"+b.Epoch+":"+b.Asset]
		status := "matched"
		if actual != b.Amount {
			status = "mismatch"
			r.Status = "mismatch"
		}
		r.Probes = append(r.Probes, EpochLiabilityProbe{MarketID: b.MarketID, Epoch: b.Epoch, Asset: b.Asset, Expected: b.Amount, Actual: actual, Status: status})
	}
	return r
}
