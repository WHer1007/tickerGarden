package readmodel

import (
	"errors"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"tickergarden/backend/internal/deployment"
)

// CandidateSet intentionally has no SyncStatus and is not a publishable Snapshot.
// Completeness here is against the supplied batch/source inventory, not chain
// history. Publication still requires independent enumeration and reconciliation.
type CandidateSet struct {
	HistoryEventEmitters           []string                    `json:"historyEventEmitters,omitempty"`
	FeeReconciliation              *FeeReconciliationCandidate `json:"feeReconciliation,omitempty"`
	FeeClaims                      []FeeClaimCandidate         `json:"feeClaims"`
	HistoryStartHash               string                      `json:"historyStartHash"`
	HistoryEventCoverageVerified   bool                        `json:"historyEventCoverageVerified"`
	HistoryReceiptRootsVerified    bool                        `json:"historyReceiptRootsVerified"`
	HistoryStartBlock              uint64                      `json:"historyStartBlock"`
	TreasuryClaimHistoryVerified   bool                        `json:"treasuryClaimHistoryVerified"`
	TreasuryClaims                 []TreasuryClaimCandidate    `json:"treasuryClaims"`
	ServiceCredits                 []ServiceCreditCandidate    `json:"serviceCredits"`
	ServiceCreditHistoryVerified   bool                        `json:"serviceCreditHistoryVerified"`
	HolderMarkets                  []HolderMarketCandidate     `json:"holderMarkets"`
	CreatorEpochs                  []CreatorEpochCandidate     `json:"creatorEpochs"`
	ProtocolEventInventoryVerified bool                        `json:"protocolEventInventoryVerified"`
	EmitterAddressBindingsVerified bool                        `json:"emitterAddressBindingsVerified"`
	Accounts                       []AccountCandidate          `json:"accounts"`
	ChainID                        uint64                      `json:"chainId"`
	BlockNumber                    string                      `json:"blockNumber"`
	BlockHash                      string                      `json:"blockHash"`
	PublicationEligible            bool                        `json:"publicationEligible"`
	Markets                        []MarketReadModel           `json:"markets"`
	Configs                        []ConfigReadModel           `json:"configs"`
	Positions                      []UserPositionReadModel     `json:"positions"`
}

// Sources must contain exactly market:<id>, config:<kind>:<id>, and
// account:<asset>:<user> and position:<user>:<market> entries corresponding to the batch's output inventory.
func BuildCandidateSet(batch deployment.ObservationBatch, sources map[string]SourceBlock) (CandidateSet, error) {
	fail := func() (CandidateSet, error) {
		return CandidateSet{}, errors.New("incomplete candidate set or unresolved cross-reference")
	}
	block, e := strconv.ParseUint(batch.BlockNumber, 0, 64)
	if e != nil || batch.BlockNumber != "0x"+strconv.FormatUint(block, 16) || !candidateHash.MatchString(batch.BlockHash) || batch.Expected != len(batch.Observations) || len(batch.Observations) > 100000 {
		return fail()
	}
	rows := map[string]deployment.StateObservation{}
	markets, configs, positions, accounts := []string{}, []string{}, []string{}, []string{}
	expected := map[string]bool{}
	for _, o := range batch.Observations {
		key := o.Kind + ":" + o.Key
		if _, ok := rows[key]; ok || o.Value == nil {
			return fail()
		}
		rows[key] = o
		switch o.Kind {
		case "market":
			markets = append(markets, o.Key)
			expected["market:"+o.Key] = true
		case "quote", "baseline", "template", "asset":
			configs = append(configs, key)
			expected["config:"+key] = true
		case "vaultPosition":
			accounts = append(accounts, o.Key)
			expected["account:"+o.Key] = true
		case "gaugePosition":
			positions = append(positions, o.Key)
			expected["position:"+o.Key] = true
		}
	}
	if len(markets) > 1000 || len(configs) > 4096 || len(positions) > 10000 || len(accounts) > 10000 || len(expected) != len(sources) {
		return fail()
	}
	for key := range sources {
		if !expected[key] {
			return fail()
		}
	}
	sort.Strings(markets)
	sort.Strings(configs)
	sort.Strings(positions)
	sort.Strings(accounts)
	out := CandidateSet{Accounts: []AccountCandidate{}, ChainID: batch.ChainID, BlockNumber: strconv.FormatUint(block, 10), BlockHash: batch.BlockHash, Markets: []MarketReadModel{}, Configs: []ConfigReadModel{}, Positions: []UserPositionReadModel{}}
	configIndex := map[string]ConfigReadModel{}
	for _, key := range configs {
		o := rows[key]
		c, e := BuildConfigCandidate(batch, o.Kind, o.Key, sources["config:"+key])
		if e != nil {
			return fail()
		}
		out.Configs = append(out.Configs, c)
		configIndex[key] = c
	}
	marketIndex := map[string]MarketReadModel{}
	for _, id := range markets {
		m, e := BuildMarketCandidate(batch, id, sources["market:"+id])
		if e != nil {
			return fail()
		}
		q, ok := configIndex["quote:"+m.QuoteAssetConfigID]
		if !ok || q.Values["quoteAsset"] != m.QuoteAsset || q.Values["tickerGardenBaselineId"] != m.TickerGardenBaselineID {
			return fail()
		}
		if _, ok := configIndex["baseline:"+m.TickerGardenBaselineID]; !ok {
			return fail()
		}
		templateID, ok := rows["market:"+id].Value["launchTemplateId"].(string)
		if !ok {
			return fail()
		}
		if template, ok := configIndex["template:"+templateID]; !ok || template.Values["graduatedHook"] != m.CanonicalRoute.Hook || template.Values["graduationExecutor"] != m.CanonicalRoute.GraduationExecutor {
			return fail()
		}
		if m.AssetUID != "0x"+strings.Repeat("0", 64) {
			if _, ok := configIndex["asset:"+m.AssetUID]; !ok {
				return fail()
			}
		}
		marketIndex[id] = m
		out.Markets = append(out.Markets, m)
	}
	coveredAllocations := map[string]bool{}
	accountSums := map[string]*big.Int{}
	for _, key := range positions {
		parts := strings.Split(key, ":")
		if len(parts) != 2 {
			return fail()
		}
		user, id := parts[0], parts[1]
		m, ok := marketIndex[id]
		if !ok {
			return fail()
		}
		p, e := BuildPositionCandidate(batch, id, user, sources["market:"+id], sources["position:"+key])
		if e != nil {
			return fail()
		}
		out.Positions = append(out.Positions, p)
		coveredAllocations[m.AssetUID+":"+user+":"+id] = true
		key = m.AssetUID + ":" + user
		if accountSums[key] == nil {
			accountSums[key] = new(big.Int)
		}
		amount, _ := raw(p.Allocated)
		accountSums[key].Add(accountSums[key], amount)
	}
	for _, o := range batch.Observations {
		if o.Kind == "vaultAllocation" && !coveredAllocations[o.Key] {
			return fail()
		}
	}
	for _, key := range accounts {
		parts := strings.Split(key, ":")
		if len(parts) != 2 {
			return fail()
		}
		a, e := BuildAccountCandidate(batch, parts[0], parts[1], sources["config:asset:"+parts[0]], sources["account:"+key])
		if e != nil {
			return fail()
		}
		allocated, _ := raw(a.Allocated)
		sum := accountSums[key]
		if sum == nil {
			sum = new(big.Int)
		}
		if sum.Cmp(allocated) != 0 {
			return fail()
		}
		out.Accounts = append(out.Accounts, a)
	}

	if verifyCandidatePrincipal(out, rows) != nil {
		return fail()
	}
	out.CreatorEpochs, e = buildCreatorCandidates(batch, marketIndex)
	if e != nil {
		return fail()
	}
	out.HolderMarkets, e = BuildHolderCandidates(batch, marketIndex)
	if e != nil {
		return fail()
	}
	return out, nil
}

// HasVerifiedHistory accepts complete receipt roots or independently rechecked project event coverage.
func (c CandidateSet) HasVerifiedHistory() bool {
	return c.HistoryReceiptRootsVerified || c.HistoryEventCoverageVerified
}
