package readmodel

import (
	"context"
	"errors"
	"math/big"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/feeledger"
)

// VerifyFeeLedgerRPC compares the locally replayed expected inventory with fresh
// hash-pinned calls. Callers must establish candidate provenance, manifest/code
// identity and canonical chain identity before and after this comparison.
// Neither report booleans nor internal consistency of RPC getters substitutes
// for visiting every expected bucket. This still does not prove full settlement.
func VerifyFeeLedgerRPC(ctx context.Context, rpc deployment.BindingObserver, m deployment.Manifest, c CandidateSet) error {
	bad := errors.New("candidate event fee ledger RPC mismatch or unavailable")
	if len(c.Markets) == 0 {
		return VerifyFeeCoverageRPC(ctx, rpc, m, c)
	}
	evidence := c.FeeReconciliation
	if evidence == nil || evidence.Status != "matched" || evidence.Reason != "" || evidence.Report == nil || evidence.ChainID != c.ChainID || evidence.BlockHash != c.BlockHash || evidence.BlockNumber != c.BlockNumber || evidence.StartBlock != c.HistoryStartBlock || !c.HasVerifiedHistory() || !c.ProtocolEventInventoryVerified || !c.EmitterAddressBindingsVerified {
		return bad
	}
	report := evidence.Report
	if report.Scope != "fee-liabilities-v1" || !report.MatchesKnownLiabilities || report.Missing != 0 || report.Failed != 0 || len(report.Unexpected) != 0 || report.Expected != len(report.Probes) || report.Completed != report.Expected || report.Expected == 0 || len(report.Probes) > 18000 {
		return bad
	}
	probes := map[string]feeledger.Probe{}
	for _, p := range report.Probes {
		key := p.Kind + ":" + p.Key + ":" + p.Field
		if _, ok := probes[key]; ok {
			return bad
		}
		if p.Status != "matched" || p.Actual == nil {
			return bad
		}
		for _, raw := range []string{p.Expected, *p.Actual} {
			if len(raw) > 78 {
				return bad
			}
			n, ok := new(big.Int).SetString(raw, 10)
			if !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != raw {
				return bad
			}
		}
		probes[key] = p
	}
	visited := map[string]bool{}
	err := verifyFeeCoverageWithCheck(ctx, rpc, m, c, func(kind, key, field string, value *big.Int) error {
		id := kind + ":" + key + ":" + field
		p, ok := probes[id]
		if !ok || visited[id] {
			return bad
		}
		comparison := "equal"
		if kind == "feeSolvency" && field == "balance" {
			comparison = "atLeast"
		}
		if p.Comparison != comparison {
			return bad
		}
		expected, _ := new(big.Int).SetString(p.Expected, 10)
		observed, _ := new(big.Int).SetString(*p.Actual, 10)
		if comparison == "equal" {
			if value.Cmp(expected) != 0 || observed.Cmp(expected) != 0 {
				return bad
			}
		} else if value.Cmp(expected) < 0 || observed.Cmp(expected) < 0 {
			return bad
		}
		visited[id] = true
		return nil
	})
	if err != nil || len(visited) != len(probes) {
		return bad
	}
	return nil
}
