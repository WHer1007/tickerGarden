package readmodel

import (
	"errors"
	"math/big"
	"reflect"
	"tickergarden/backend/internal/deployment"
)

// Recompute principal totals from candidate accounts, never from stored checks.
// Matching these totals is not independent authentication of observation values
// or a full rewards/fees solvency proof.
func verifyCandidatePrincipal(set CandidateSet, rows map[string]deployment.StateObservation) error {
	bad := errors.New("candidate principal totals or coverage mismatch")
	type totals struct{ deposited, allocated *big.Int }
	sums := map[string]totals{}
	for _, a := range set.Accounts {
		sum, ok := sums[a.AssetUID]
		if !ok {
			sum = totals{new(big.Int), new(big.Int)}
		}
		dep, e := raw(a.Deposited)
		if e != nil {
			return bad
		}
		alloc, e := raw(a.Allocated)
		if e != nil {
			return bad
		}
		sum.deposited.Add(sum.deposited, dep)
		sum.allocated.Add(sum.allocated, alloc)
		sums[a.AssetUID] = sum
	}
	assets := map[string]bool{}
	tokens := map[string]bool{}
	for _, c := range set.Configs {
		if c.Kind != "asset" {
			continue
		}
		token, ok := c.Values["stockToken"].(string)
		if !ok || tokens[token] {
			return bad
		}
		tokens[token] = true
		assets[c.ID] = true
		v := rows["vaultSolvency:"+c.ID].Value
		if v == nil || !reflect.DeepEqual(v["assetUid"], c.ID) || !reflect.DeepEqual(v["vault"], c.Values["userStockVault"]) || !reflect.DeepEqual(v["stockToken"], token) {
			return bad
		}
		numbers := []*big.Int{}
		for _, field := range []string{"totalDeposited", "totalAllocated", "tokenBalance"} {
			value, ok := candidateScalar(v[field], "uint256")
			if !ok {
				return bad
			}
			n, _ := raw(value.(string))
			numbers = append(numbers, n)
		}
		dep, alloc, balance := numbers[0], numbers[1], numbers[2]
		sum, ok := sums[c.ID]
		if !ok {
			sum = totals{new(big.Int), new(big.Int)}
		}
		if sum.deposited.Cmp(dep) != 0 || sum.allocated.Cmp(alloc) != 0 || alloc.Cmp(dep) > 0 || balance.Cmp(dep) < 0 {
			return bad
		}
	}
	for id := range sums {
		if !assets[id] {
			return bad
		}
	}
	for _, o := range rows {
		if o.Kind == "vaultSolvency" && !assets[o.Key] {
			return bad
		}
	}
	return nil
}
