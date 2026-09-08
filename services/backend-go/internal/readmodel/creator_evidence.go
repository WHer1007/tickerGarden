package readmodel

import (
	"errors"
	"math/big"

	"tickergarden/backend/internal/deployment"
)

// VerifyCreatorEpochEvidence binds replayed amounts to the current candidate's
// epoch getters. The caller must then authenticate those getters and beneficiary
// identities against canonical RPC state; this function performs no RPC reads.
func VerifyCreatorEpochEvidence(c CandidateSet) error {
	bad := errors.New("creator epoch event evidence missing or inconsistent")
	if len(c.Markets) == 0 && len(c.CreatorEpochs) == 0 {
		return nil
	}
	e := c.FeeReconciliation
	if e == nil || e.Status != "matched" || e.ChainID != c.ChainID || e.BlockNumber != c.BlockNumber || e.BlockHash != c.BlockHash || e.StartBlock != c.HistoryStartBlock || !c.HasVerifiedHistory() || !c.ProtocolEventInventoryVerified || !c.EmitterAddressBindingsVerified || e.CreatorEpochs == nil {
		return bad
	}
	r := e.CreatorEpochs
	if r.Status != "matched" || r.Reason != "" || len(c.CreatorEpochs) == 0 || len(c.CreatorEpochs) > deployment.MaxCreatorEpochReads || len(r.Probes) != len(c.CreatorEpochs)*2 {
		return bad
	}
	actual := map[string]string{}
	for _, epoch := range c.CreatorEpochs {
		for _, pair := range [][2]string{{epoch.QuoteAsset, epoch.QuoteLiability}, {epoch.MemeAsset, epoch.MemeLiability}} {
			key := epoch.MarketID + ":" + epoch.Epoch + ":" + pair[0]
			if _, ok := actual[key]; ok {
				return bad
			}
			actual[key] = pair[1]
		}
	}
	seen := map[string]bool{}
	for _, p := range r.Probes {
		key := p.MarketID + ":" + p.Epoch + ":" + p.Asset
		value, ok := actual[key]
		if !ok || seen[key] || p.Status != "matched" || p.Expected != value || p.Actual != value || len(value) > 78 {
			return bad
		}
		n, ok := new(big.Int).SetString(value, 10)
		if !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != value {
			return bad
		}
		seen[key] = true
	}
	return nil
}
