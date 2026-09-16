package readmodel

import (
	"errors"
	"math/big"
	"strings"
	"tickergarden/backend/internal/deployment"
)

// Input holders have already passed BuildHolderCandidates. Known Holder rewards
// are a lower bound on the distributor's total quote liability: other Treasury
// markets may share that distributor. This is not independent history proof.
func verifyStoredHolderSolvency(holders []HolderMarketCandidate, batch deployment.ObservationBatch, historical ...map[string]*big.Int) error {
	bad := errors.New("candidate Holder solvency mismatch")
	number := func(v any) (*big.Int, error) {
		s, ok := v.(string)
		if !ok || len(s) > 78 {
			return nil, bad
		}
		n, e := raw(s)
		if e != nil || n.String() != s {
			return nil, bad
		}
		return n, nil
	}
	sums := map[string]*big.Int{}
	pendingService := map[string]*big.Int{}
	policies := map[string]string{}
	for _, h := range holders {
		key := h.Distributor + ":" + h.QuoteAsset
		if sums[key] == nil {
			sums[key] = new(big.Int)
		}
		switch h.Mode {
		case "continuous-24h":
			if h.Continuous == nil {
				return bad
			}
			n, e := number(h.Continuous.Outstanding)
			if e != nil {
				return bad
			}
			sums[key].Add(sums[key], n)
		case "epoch":
			if h.Epoch == nil {
				return bad
			}
			currentFee, err := number(h.Epoch.CurrentServiceFeeAmount)
			if err != nil || currentFee.Sign() == 0 || currentFee.BitLen() > 128 || !candidateAddress.MatchString(h.Epoch.CurrentServiceFeeAsset) {
				return bad
			}
			policy := h.Epoch.CurrentServiceFeeAsset + ":" + h.Epoch.CurrentServiceFeeAmount
			if previous, exists := policies[h.Distributor]; exists && previous != policy {
				return bad
			}
			policies[h.Distributor] = policy
			currentKey := h.Distributor + ":" + h.Epoch.CurrentServiceFeeAsset
			if sums[currentKey] == nil {
				sums[currentKey] = new(big.Int)
			}
			for _, entry := range h.Epoch.Entries {
				n, e := number(entry.Values["outstandingQuoteAmount"])
				if e != nil {
					return bad
				}
				sums[key].Add(sums[key], n)
				fee, err := number(entry.Values["serviceFeeAmount"])
				if err != nil {
					return bad
				}
				if fee.Sign() != 0 {
					asset := entry.Values["serviceFeeAsset"]
					if !candidateAddress.MatchString(asset) {
						return bad
					}
					serviceKey := h.Distributor + ":" + asset
					if sums[serviceKey] == nil {
						sums[serviceKey] = new(big.Int)
					}
					// Finalize/reset moves fees into withdrawable service credits;
					// old epoch fee amounts are no longer an outstanding lower bound.
					if entry.Values["status"] == "1" || entry.Values["status"] == "2" {
						if pendingService[serviceKey] == nil {
							pendingService[serviceKey] = new(big.Int)
						}
						pendingService[serviceKey].Add(pendingService[serviceKey], fee)
					}
				}
			}
		default:
			return bad
		}
	}
	if len(historical) > 1 {
		return bad
	}
	if len(historical) == 1 {
		for key := range historical[0] {
			distributor, asset, ok := strings.Cut(key, ":")
			if !ok || !candidateAddress.MatchString(asset) {
				return bad
			}
			if _, known := policies[distributor]; known && sums[key] == nil {
				sums[key] = new(big.Int)
			}
		}
	}
	seen := map[string]bool{}
	for _, o := range batch.Observations {
		if o.Kind != "treasurySolvency" {
			continue
		}
		distributor, dok := o.Value["treasuryDistributor"].(string)
		asset, aok := o.Value["asset"].(string)
		key := distributor + ":" + asset
		sum, ok := sums[key]

		if !dok || !aok || !ok || o.Key != key || seen[key] {
			return bad
		}
		seen[key] = true
		known, e := number(o.Value["knownHolderMarketOutstanding"])
		if e != nil || known.Cmp(sum) != 0 {
			return bad
		}
		quote, e := number(o.Value["totalQuoteLiability"])
		if e != nil || quote.Cmp(sum) < 0 {
			return bad
		}
		service, e := number(o.Value["totalServiceLiability"])
		if e != nil || (pendingService[key] != nil && service.Cmp(pendingService[key]) < 0) {
			return bad
		}
		required, e := number(o.Value["requiredBalance"])
		if e != nil || required.Cmp(new(big.Int).Add(quote, service)) != 0 {
			return bad
		}
		balance, e := number(o.Value["balance"])
		if e != nil || balance.Cmp(required) < 0 {
			return bad
		}
	}
	for key := range sums {
		if !seen[key] {
			return bad
		}
	}
	return nil
}
