package readmodel

import (
	"errors"
	"math/big"
	"tickergarden/backend/internal/deployment"
)

// verifyStoredFeeCoverage reconciles observations at the candidate block. It
// does not authenticate RPC state or prove that historical inventory is complete.
// c must come from BuildCandidateSet, which validates position identities, assets,
// uniqueness and inventory before this financial check.
func verifyStoredFeeCoverage(c CandidateSet, batch deployment.ObservationBatch) error {
	bad := errors.New("candidate stored fee coverage mismatch")
	rows := map[string]deployment.StateObservation{}
	for _, o := range batch.Observations {
		if o.Kind != "feeLiability" && o.Kind != "feeSolvency" {
			continue
		}
		key := o.Kind + ":" + o.Key
		if _, exists := rows[key]; exists {
			return bad
		}
		rows[key] = o
	}
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
	// Epoch holder liabilities and the FeeVault Holder bucket are the same
	// accounting inventory, unlike rounded Staker claimable lower bounds.
	holderSums := map[string]*big.Int{}
	for _, h := range c.HolderMarkets {
		if h.Mode != "epoch" {
			continue
		}
		if h.Epoch == nil {
			return bad
		}
		for _, asset := range []struct{ address, field string }{{h.QuoteAsset, "holderQuoteLiability"}, {h.MemeToken, "holderMemeLiability"}} {
			key := h.MarketID + ":" + asset.address
			if _, exists := holderSums[key]; exists {
				return bad
			}
			sum := new(big.Int)
			for _, entry := range h.Epoch.Entries {
				n, e := number(entry.Values[asset.field])
				if e != nil {
					return bad
				}
				sum.Add(sum, n)
				if sum.BitLen() > 256 {
					return bad
				}
			}
			holderSums[key] = sum
		}
	}
	claims := map[string]*big.Int{}
	for _, p := range c.Positions {
		for _, claim := range p.Claimable {
			key := p.MarketID + ":" + claim.Asset
			if claims[key] == nil {
				claims[key] = new(big.Int)
			}
			n, e := number(claim.Amount)
			if e != nil {
				return bad
			}
			claims[key].Add(claims[key], n)
		}
	}
	sums := map[string]*big.Int{}
	vault := ""
	consumed := 0
	for _, m := range c.Markets {
		for _, asset := range []string{m.QuoteAsset, m.MemeToken} {
			key := m.MarketID + ":" + asset
			row, ok := rows["feeLiability:"+key]
			if !ok || row.Value["marketId"] != m.MarketID || row.Value["feeAsset"] != asset {
				return bad
			}
			address, ok := row.Value["feeVault"].(string)
			if !ok || !candidateAddress.MatchString(address) || address == "0x0000000000000000000000000000000000000000" || (vault != "" && vault != address) {
				return bad
			}
			vault = address
			subtotal := new(big.Int)
			for _, bucket := range []string{"creator", "staker", "platform", "holder", "forfeitureReserve"} {
				n, e := number(row.Value[bucket])
				if e != nil {
					return bad
				}
				if bucket == "staker" && claims[key] != nil && claims[key].Cmp(n) > 0 {
					return bad
				}
				if bucket == "holder" && holderSums[key] != nil {
					if holderSums[key].Cmp(n) != 0 {
						return bad
					}
					delete(holderSums, key)
				}
				subtotal.Add(subtotal, n)
			}
			stored, e := number(row.Value["bucketAndReserveTotal"])
			if e != nil || stored.Cmp(subtotal) != 0 {
				return bad
			}
			if sums[asset] == nil {
				sums[asset] = new(big.Int)
			}
			sums[asset].Add(sums[asset], subtotal)
			consumed++
		}
	}
	for asset, sum := range sums {
		row, ok := rows["feeSolvency:"+asset]
		if !ok || row.Value["feeAsset"] != asset || row.Value["feeVault"] != vault {
			return bad
		}
		total, e := number(row.Value["totalLiability"])
		if e != nil || total.Cmp(sum) != 0 {
			return bad
		}
		known, e := number(row.Value["knownMarketLiabilitySum"])
		if e != nil || known.Cmp(sum) != 0 {
			return bad
		}
		balance, e := number(row.Value["balance"])
		if e != nil || balance.Cmp(total) < 0 {
			return bad
		}
		consumed++
	}
	if consumed != len(rows) || len(holderSums) != 0 {
		return bad
	}
	return nil
}
