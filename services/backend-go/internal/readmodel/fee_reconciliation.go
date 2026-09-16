package readmodel

import (
	"strconv"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/feeledger"
)

// FeeReconciliationCandidate is diagnostic evidence, not publication authority.
// A failed replay never exposes a partial ledger as an expected balance.
type FeeReconciliationCandidate struct {
	HolderEpochs  *HolderEpochReconciliation  `json:"holderEpochs,omitempty"`
	CreatorEpochs *CreatorEpochReconciliation `json:"creatorEpochs,omitempty"`
	Status        string                      `json:"status"`
	Reason        string                      `json:"reason,omitempty"`
	ChainID       uint64                      `json:"chainId"`
	StartBlock    uint64                      `json:"startBlock"`
	BlockNumber   string                      `json:"blockNumber"`
	BlockHash     string                      `json:"blockHash"`
	Report        *feeledger.Report           `json:"report,omitempty"`
}

func buildFeeReconciliation(c CandidateSet, batch deployment.ObservationBatch, vault string, inputs []feeledger.Input) FeeReconciliationCandidate {
	r := FeeReconciliationCandidate{Status: "unavailable", ChainID: c.ChainID, StartBlock: c.HistoryStartBlock, BlockNumber: c.BlockNumber, BlockHash: c.BlockHash}
	fail := func(reason string) FeeReconciliationCandidate { r.Reason = reason; return r }
	height, err := strconv.ParseUint(c.BlockNumber, 10, 64)
	if err != nil || c.BlockNumber != strconv.FormatUint(height, 10) || batch.BlockNumber != "0x"+strconv.FormatUint(height, 16) || batch.BlockHash != c.BlockHash || batch.ChainID != c.ChainID || c.HistoryStartBlock > height || batch.Expected != len(batch.Observations) {
		return fail("observation_binding_invalid")
	}
	if !c.HasVerifiedHistory() || !c.ProtocolEventInventoryVerified || !c.EmitterAddressBindingsVerified {
		return fail("history_evidence_missing")
	}
	if vault == "" {
		return fail("fee_vault_binding_missing")
	}
	holders := map[string]HolderMarketCandidate{}
	for _, h := range c.HolderMarkets {
		if _, exists := holders[h.MarketID]; exists {
			return fail("market_binding_invalid")
		}
		holders[h.MarketID] = h
	}
	markets := make([]feeledger.Market, 0, len(c.Markets))
	for _, m := range c.Markets {
		entry := feeledger.Market{ID: m.MarketID, Meme: m.MemeToken, Quote: m.QuoteAsset}
		if h, ok := holders[m.MarketID]; ok {
			if h.MemeToken != m.MemeToken || h.QuoteAsset != m.QuoteAsset {
				return fail("market_binding_invalid")
			}
			entry.Distributor = h.Distributor
			switch h.Mode {
			case "epoch":
				entry.DistributorModule = "TreasuryDistributorV1"
			case "continuous-24h":
				entry.DistributorModule = "HolderRewardsDistributorV1"
			default:
				return fail("market_binding_invalid")
			}
		}
		markets = append(markets, entry)
	}
	l, err := feeledger.New(vault, markets)
	if err != nil {
		return fail("market_binding_invalid")
	}
	// Inputs retain database block/log order. Never sort away an invalid boundary.
	for start := 0; start < len(inputs); {
		first := inputs[start].Log
		n, err := strconv.ParseUint(first.BlockNumber, 0, 64)
		if err != nil || n < c.HistoryStartBlock || n > height || (n == height && first.BlockHash != c.BlockHash) {
			return fail("event_range_invalid")
		}
		if start > 0 {
			previous := inputs[start-1].Log
			priorHeight, _ := strconv.ParseUint(previous.BlockNumber, 0, 64)
			priorIndex, _ := strconv.ParseUint(previous.LogIndex, 0, 64)
			index, indexErr := strconv.ParseUint(first.LogIndex, 0, 64)
			priorTx, _ := strconv.ParseUint(previous.TransactionIndex, 0, 64)
			tx, txErr := strconv.ParseUint(first.TransactionIndex, 0, 64)
			if indexErr != nil || txErr != nil || n < priorHeight || (n == priorHeight && (first.BlockHash != previous.BlockHash || index <= priorIndex || tx <= priorTx || first.TransactionHash == previous.TransactionHash)) {
				return fail("event_order_invalid")
			}
		}
		end := start + 1
		for end < len(inputs) && inputs[end].Log.BlockHash == first.BlockHash && inputs[end].Log.TransactionHash == first.TransactionHash {
			end++
		}
		if _, err := l.ApplyTransaction(inputs[start:end]); err != nil {
			return fail("event_replay_invalid")
		}
		start = end
	}
	holderReport := reconcileHolderEpochs(c, batch, vault, inputs)
	r.HolderEpochs = &holderReport
	creatorReport := reconcileCreatorEpochs(c, vault, inputs)
	r.CreatorEpochs = &creatorReport
	report := l.Reconcile(batch.Observations)
	r.Report = &report
	r.Status = "mismatch"
	if report.MatchesKnownLiabilities {
		r.Status = "matched"
	}
	return r
}
