package readmodel

import (
	"errors"
	"math/big"
	"sort"
	"strings"
	"tickergarden/backend/internal/deployment"
)

// Requests collect service fees; finalize, cancellation and expiry only change
// credit ownership. Only ServiceCreditWithdrawn reduces the total liability.
// Event-derived ownership uses the observed immutable service treasury.
// This lower bound does not prove current credit storage or token transfers,
// and unindexed Treasury markets may contribute additional service liabilities.
func (h *holderClaimHistory) verifyServiceLiability(holders []HolderMarketCandidate, batch deployment.ObservationBatch) error {
	bad := errors.New("Holder service liability below receipt history")
	distributors := map[string]bool{}
	treasuries := map[string]string{}
	for _, holder := range holders {
		if holder.Mode == "epoch" {
			if holder.Epoch == nil || !candidateAddress.MatchString(holder.Epoch.RootServiceTreasury) || holder.Epoch.RootServiceTreasury == "0x0000000000000000000000000000000000000000" || holder.Epoch.RootServiceTreasury == holder.Distributor {
				return bad
			}
			treasury := holder.Epoch.RootServiceTreasury
			if previous, exists := treasuries[holder.Distributor]; exists && previous != treasury {
				return bad
			}
			treasuries[holder.Distributor] = treasury
			distributors[holder.Distributor] = true
		}
	}
	credits := map[string]*big.Int{}
	for _, operation := range h.serviceOperations {
		if !distributors[operation.distributor] {
			continue
		}
		beneficiary := operation.beneficiary
		if operation.treasury {
			beneficiary = treasuries[operation.distributor]
		}
		key := operation.distributor + ":" + operation.asset + ":" + beneficiary
		if credits[key] == nil {
			credits[key] = new(big.Int)
		}
		amount, err := raw(operation.amount)
		if err != nil {
			return bad
		}
		if operation.withdrawal {
			// withdrawServiceCredit always consumes the beneficiary's full credit.
			if amount.Sign() == 0 || amount.Cmp(credits[key]) != 0 {
				return bad
			}
			credits[key].SetInt64(0)
		} else {
			credits[key].Add(credits[key], amount)
		}
	}
	seen := map[string]bool{}
	for _, o := range batch.Observations {
		if o.Kind != "treasurySolvency" {
			continue
		}
		distributor, _ := o.Value["treasuryDistributor"].(string)
		asset, _ := o.Value["asset"].(string)
		key := distributor + ":" + asset
		expected, exists := h.service[key]
		if !distributors[distributor] || !exists {
			continue
		}
		amount, _ := o.Value["totalServiceLiability"].(string)
		total, err := raw(amount)
		if err != nil || seen[key] || o.Key != key || total.Cmp(expected) < 0 {
			return bad
		}
		seen[key] = true
	}
	for key := range h.service {
		distributor, _, _ := strings.Cut(key, ":")
		if distributors[distributor] && !seen[key] {
			return bad
		}
	}
	if len(credits) > MaxServiceCreditReads {
		return bad
	}
	keys := make([]string, 0, len(credits))
	for key := range credits {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]ServiceCreditCandidate, 0, len(keys))
	for _, key := range keys {
		parts := strings.Split(key, ":")
		out = append(out, ServiceCreditCandidate{Distributor: parts[0], Asset: parts[1], Beneficiary: parts[2], Amount: credits[key].String()})
	}
	h.creditCandidates = out
	return nil
}

// The caller has validated a one-time finalize/reset transition for this request.
func (h *holderClaimHistory) releaseService(key holderClaimKey, treasury bool) {
	request := h.requests[key]
	serviceKey := key.distributor + ":" + request["serviceFeeAsset"]
	fee, _ := raw(request["serviceFeeAmount"])
	h.serviceOperations = append(h.serviceOperations, holderServiceOperation{distributor: key.distributor, asset: request["serviceFeeAsset"], beneficiary: request["requester"], amount: fee.String(), treasury: treasury})
	if h.serviceAvailable[serviceKey] == nil {
		h.serviceAvailable[serviceKey] = new(big.Int)
	}
	h.serviceAvailable[serviceKey].Add(h.serviceAvailable[serviceKey], fee)
}

type holderServiceOperation struct {
	distributor, asset, beneficiary, amount string
	treasury, withdrawal                    bool
}

const MaxServiceCreditReads = 4096

type ServiceCreditCandidate struct {
	Distributor string `json:"distributor"`
	Asset       string `json:"asset"`
	Beneficiary string `json:"beneficiary"`
	Amount      string `json:"amount"`
}
