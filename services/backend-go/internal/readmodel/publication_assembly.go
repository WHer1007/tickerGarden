package readmodel

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"regexp"
	"sort"
	"strconv"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/feeledger"
	"tickergarden/backend/internal/holderledger"
)

const MaxPublicationEvidenceBytes = 1 << 20

var ErrPublicationAssembly = errors.New("financial publication evidence is incomplete or inconsistent")
var publicationSHA256 = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var publicationDigest = regexp.MustCompile(`^[0-9a-f]{64}$`)

// PublicationChecks records checks that the producer must execute against two
// independently configured RPC endpoints. It is retained with the snapshot;
// callers cannot use CandidateSet.PublicationEligible as a substitute.
type PublicationChecks struct {
	CandidateEventCoverageVerified bool `json:"candidateEventCoverageVerified"`
	PrimaryRPCVerified             bool `json:"primaryRpcVerified"`
	IndependentRPCVerified         bool `json:"independentRpcVerified"`
	HistoryOriginVerified          bool `json:"historyOriginVerified"`
	CandidateReceiptRootVerified   bool `json:"candidateReceiptRootVerified"`
	StaticRuntimeVerified          bool `json:"staticRuntimeVerified"`
	AssetIdentitiesVerified        bool `json:"assetIdentitiesVerified"`
	VaultPrincipalVerified         bool `json:"vaultPrincipalVerified"`
	MarketRoutesVerified           bool `json:"marketRoutesVerified"`
	CurveProgressVerified          bool `json:"curveProgressVerified"`
	ConfigValuesVerified           bool `json:"configValuesVerified"`
	GaugePositionsVerified         bool `json:"gaugePositionsVerified"`
	FeeLiabilitiesVerified         bool `json:"feeLiabilitiesVerified"`
	CreatorLiabilitiesVerified     bool `json:"creatorLiabilitiesVerified"`
	HolderLiabilitiesVerified      bool `json:"holderLiabilitiesVerified"`
	TreasuryArtifactsVerified      bool `json:"treasuryArtifactsVerified"`
}

// PublicationRPCSources stores hashes of configured endpoint strings, avoiding
// credential persistence while proving the exact same endpoint was not used for
// both checks. Provider independence still requires an operational review.
type PublicationRPCSources struct {
	PrimaryEndpointHash     string `json:"primaryEndpointHash"`
	IndependentEndpointHash string `json:"independentEndpointHash"`
}

func (c PublicationChecks) valid() bool {
	return c.PrimaryRPCVerified && c.IndependentRPCVerified && c.HistoryOriginVerified &&
		(c.CandidateReceiptRootVerified || c.CandidateEventCoverageVerified) && c.StaticRuntimeVerified && c.AssetIdentitiesVerified &&
		c.VaultPrincipalVerified && c.MarketRoutesVerified && c.CurveProgressVerified &&
		c.ConfigValuesVerified && c.GaugePositionsVerified && c.FeeLiabilitiesVerified &&
		c.CreatorLiabilitiesVerified && c.HolderLiabilitiesVerified && c.TreasuryArtifactsVerified
}

// HolderPublicationBinding is produced only after AuditHistory and the fresh
// same-block Ledger.Reconcile both succeed for one continuous Holder market.
type HolderPublicationBinding struct {
	Scope                     holderledger.CheckpointScope
	Audit                     holderledger.CheckpointAudit
	PrimaryReconciliation     holderledger.Reconciliation
	IndependentReconciliation holderledger.Reconciliation
}

type HolderPublicationEvidence struct {
	MarketID               string `json:"marketId"`
	Token                  string `json:"token"`
	Distributor            string `json:"distributor"`
	ScopeDigest            string `json:"scopeDigest"`
	CheckpointCount        int64  `json:"checkpointCount"`
	StartBlockNumber       string `json:"startBlockNumber"`
	StartBlockHash         string `json:"startBlockHash"`
	HeadBlockNumber        string `json:"headBlockNumber"`
	HeadBlockHash          string `json:"headBlockHash"`
	AuditDigest            string `json:"auditDigest"`
	AccountsChecked        int    `json:"accountsChecked"`
	AccountInventoryDigest string `json:"accountInventoryDigest"`
}

type PublicationEvidence struct {
	Version                  int                         `json:"version"`
	ChainID                  uint64                      `json:"chainId"`
	CandidateBlockNumber     string                      `json:"candidateBlockNumber"`
	CandidateBlockHash       string                      `json:"candidateBlockHash"`
	CandidateDigest          string                      `json:"candidateDigest"`
	ManifestHash             string                      `json:"manifestHash"`
	HistoryStartBlock        uint64                      `json:"historyStartBlock"`
	HistoryStartHash         string                      `json:"historyStartHash"`
	RPCSources               PublicationRPCSources       `json:"rpcSources"`
	Checks                   PublicationChecks           `json:"checks"`
	ContinuousHolderEvidence []HolderPublicationEvidence `json:"continuousHolderEvidence"`
}

// AssemblePublication converts a fully checked candidate into the frozen API
// snapshot and a durable evidence record. The caller must have executed every
// check represented by checks against two distinct RPC configurations.
func AssemblePublication(candidate CandidateSet, manifestHash string, head chainrpc.Header, sources PublicationRPCSources, checks PublicationChecks, bindings []HolderPublicationBinding) ([]byte, []byte, error) {
	fail := func() ([]byte, []byte, error) { return nil, nil, ErrPublicationAssembly }
	feeEvidence := candidate.FeeReconciliation
	if candidate.PublicationEligible || !candidateHash.MatchString(manifestHash) || !candidateHash.MatchString(sources.PrimaryEndpointHash) || !candidateHash.MatchString(sources.IndependentEndpointHash) || sources.PrimaryEndpointHash == sources.IndependentEndpointHash || !checks.valid() ||
		feeEvidence == nil || !validPublicationFeeReport(feeEvidence.Report) ||
		!candidate.HasVerifiedHistory() || !candidate.TreasuryClaimHistoryVerified ||
		!candidate.ServiceCreditHistoryVerified || !candidate.ProtocolEventInventoryVerified ||
		!candidate.EmitterAddressBindingsVerified || feeEvidence.Status != "matched" ||
		feeEvidence.Reason != "" || feeEvidence.ChainID != candidate.ChainID ||
		feeEvidence.StartBlock != candidate.HistoryStartBlock || feeEvidence.BlockNumber != candidate.BlockNumber ||
		feeEvidence.BlockHash != candidate.BlockHash ||
		VerifyCreatorEpochEvidence(candidate) != nil {
		return fail()
	}
	candidateHeight, err := Height(candidate.BlockNumber)
	headHeight, headErr := head.Height()
	if err != nil || headErr != nil || headHeight < candidateHeight || !candidateHash.MatchString(candidate.BlockHash) || !candidateHash.MatchString(head.Hash) || (headHeight == candidateHeight && head.Hash != candidate.BlockHash) {
		return fail()
	}
	continuous := map[string]HolderMarketCandidate{}
	marketIndex := map[string]MarketReadModel{}
	for _, market := range candidate.Markets {
		marketIndex[market.MarketID] = market
	}
	for _, holder := range candidate.HolderMarkets {
		if holder.Mode == "continuous-24h" {
			if _, exists := continuous[holder.MarketID]; exists {
				return fail()
			}
			continuous[holder.MarketID] = holder
		}
	}
	holderEvidence := make([]HolderPublicationEvidence, 0, len(bindings))
	seen := map[string]bool{}
	for _, binding := range bindings {
		scope, audit := binding.Scope, binding.Audit
		primary, independent := binding.PrimaryReconciliation, binding.IndependentReconciliation
		holder, ok := continuous[scope.MarketID]
		market, marketOK := marketIndex[scope.MarketID]
		digest, digestErr := holderledger.ScopeDigest(scope)
		auditHeight, auditHeightErr := audit.Head.Height()
		auditStartHeight, auditStartErr := audit.Start.Height()
		marketStartHeight, marketStartErr := Height(market.Source.BlockNumber)
		if !ok || !marketOK || seen[scope.MarketID] || digestErr != nil || digest != audit.ScopeDigest || scope.Config.ChainID != candidate.ChainID ||
			scope.Token != holder.MemeToken || scope.Config.Quote != holder.QuoteAsset || scope.Config.Binding.Distributor != holder.Distributor ||
			auditStartErr != nil || marketStartErr != nil || auditStartHeight != marketStartHeight || audit.Start.Hash != market.Source.BlockHash || candidate.HistoryStartBlock > auditStartHeight ||
			auditHeightErr != nil || auditHeight != candidateHeight || audit.Head.Hash != candidate.BlockHash || audit.Revisions < 1 ||
			!audit.AuthenticatedSeed || !audit.CheckpointChainValid || !audit.RawRootsReverified || !audit.EvidenceReplayValid ||
			audit.HistoryVerified || audit.PublicationEligible || !publicationSHA256.MatchString(audit.EvidenceDigest) ||
			!validHolderReconciliation(primary, audit, scope.MarketID) || !validHolderReconciliation(independent, audit, scope.MarketID) ||
			primary.AccountsChecked != independent.AccountsChecked || primary.AccountInventoryDigest != independent.AccountInventoryDigest {
			return fail()
		}
		holderEvidence = append(holderEvidence, HolderPublicationEvidence{MarketID: scope.MarketID, Token: scope.Token, Distributor: scope.Config.Binding.Distributor, ScopeDigest: digest, CheckpointCount: audit.Revisions, StartBlockNumber: strconv.FormatUint(auditStartHeight, 10), StartBlockHash: audit.Start.Hash, HeadBlockNumber: candidate.BlockNumber, HeadBlockHash: audit.Head.Hash, AuditDigest: audit.EvidenceDigest, AccountsChecked: primary.AccountsChecked, AccountInventoryDigest: primary.AccountInventoryDigest})
		seen[scope.MarketID] = true
	}
	if len(seen) != len(continuous) {
		return fail()
	}
	sort.Slice(holderEvidence, func(i, j int) bool { return holderEvidence[i].MarketID < holderEvidence[j].MarketID })
	accounts := make([]UserAccountReadModel, len(candidate.Accounts))
	for i, account := range candidate.Accounts {
		accounts[i] = UserAccountReadModel{User: account.User, AssetUID: account.AssetUID, Vault: account.Vault, Deposited: account.Deposited, Allocated: account.Allocated, Free: account.Free, Source: account.Source}
	}
	blockHash, headHash := candidate.BlockHash, head.Hash
	headNumber := strconv.FormatUint(headHeight, 10)
	lag := strconv.FormatUint(headHeight-candidateHeight, 10)
	snapshot := Snapshot{ExecutionSpecID: "V1-EXEC-11", ReconciliationAlerts: []json.RawMessage{}, Sync: SyncStatus{ChainID: candidate.ChainID, Status: "synced", BlockNumber: &candidate.BlockNumber, BlockHash: &blockHash, Finality: "finalized", HeadBlockNumber: &headNumber, HeadBlockHash: &headHash, LagBlocks: &lag, Revision: candidate.BlockNumber + ":" + candidate.BlockHash}, Markets: candidate.Markets, Configs: candidate.Configs, Accounts: &accounts, Positions: candidate.Positions}
	snapshotRaw, err := json.Marshal(snapshot)
	if err != nil || len(snapshotRaw) > MaxSnapshotBytes {
		return fail()
	}
	parsed, err := Parse(snapshotRaw, candidate.ChainID)
	canonicalParsed, marshalErr := json.Marshal(parsed)
	if err != nil || marshalErr != nil || !bytes.Equal(canonicalParsed, snapshotRaw) {
		return fail()
	}
	candidateRaw, err := json.Marshal(candidate)
	if err != nil {
		return fail()
	}
	evidence := PublicationEvidence{Version: 1, ChainID: candidate.ChainID, CandidateBlockNumber: candidate.BlockNumber, CandidateBlockHash: candidate.BlockHash, CandidateDigest: deployment.Hash(candidateRaw), ManifestHash: manifestHash, HistoryStartBlock: candidate.HistoryStartBlock, HistoryStartHash: candidate.HistoryStartHash, RPCSources: sources, Checks: checks, ContinuousHolderEvidence: holderEvidence}
	evidenceRaw, err := json.Marshal(evidence)
	if err != nil || len(evidenceRaw) > MaxPublicationEvidenceBytes {
		return fail()
	}
	if _, err = parsePublicationEvidence(evidenceRaw, snapshot); err != nil {
		return fail()
	}
	return snapshotRaw, evidenceRaw, nil
}

func validPublicationFeeReport(report *feeledger.Report) bool {
	if report == nil || report.Scope != "fee-liabilities-v1" || !report.MatchesKnownLiabilities || report.HistoryComplete || report.PublicationEligible || report.Expected == 0 || report.Expected != len(report.Probes) || report.Completed != report.Expected || report.Missing != 0 || report.Failed != 0 || len(report.Unexpected) != 0 || len(report.Probes) > 18000 {
		return false
	}
	seen := make(map[string]bool, len(report.Probes))
	for _, probe := range report.Probes {
		key := probe.Kind + ":" + probe.Key + ":" + probe.Field
		if seen[key] || probe.Status != "matched" || probe.Actual == nil || (probe.Comparison != "equal" && probe.Comparison != "atLeast") || (probe.Comparison == "atLeast" && (probe.Kind != "feeSolvency" || probe.Field != "balance")) {
			return false
		}
		values := make([]*big.Int, 0, 2)
		for _, raw := range []string{probe.Expected, *probe.Actual} {
			value, ok := new(big.Int).SetString(raw, 10)
			if !ok || value.Sign() < 0 || value.BitLen() > 256 || value.String() != raw {
				return false
			}
			values = append(values, value)
		}
		if (probe.Comparison == "equal" && values[1].Cmp(values[0]) != 0) || (probe.Comparison == "atLeast" && values[1].Cmp(values[0]) < 0) {
			return false
		}
		seen[key] = true
	}
	return true
}

func validHolderReconciliation(reconciliation holderledger.Reconciliation, audit holderledger.CheckpointAudit, marketID string) bool {
	return reconciliation.Block == audit.Head && reconciliation.MarketID == marketID && reconciliation.FieldsMatched &&
		reconciliation.DifferenceCount == 0 && len(reconciliation.Differences) == 0 &&
		reconciliation.AccountsChecked >= 1 && publicationSHA256.MatchString(reconciliation.AccountInventoryDigest) && !reconciliation.PublicationEligible
}

func parsePublicationEvidence(raw []byte, snapshot Snapshot) (PublicationEvidence, error) {
	var evidence PublicationEvidence
	if len(raw) == 0 || len(raw) > MaxPublicationEvidenceBytes {
		return evidence, ErrPublicationAssembly
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if uniqueJSON(decoder, 0) != nil {
		return evidence, ErrPublicationAssembly
	}
	if _, err := decoder.Token(); err != io.EOF {
		return evidence, ErrPublicationAssembly
	}
	decoder = json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&evidence) != nil || decoder.Decode(new(any)) != io.EOF || evidence.Version != 1 || !evidence.Checks.valid() || snapshot.Sync.BlockNumber == nil || snapshot.Sync.BlockHash == nil || evidence.ChainID != snapshot.Sync.ChainID || evidence.CandidateBlockNumber != *snapshot.Sync.BlockNumber || evidence.CandidateBlockHash != *snapshot.Sync.BlockHash || !candidateHash.MatchString(evidence.CandidateDigest) || !candidateHash.MatchString(evidence.ManifestHash) || !candidateHash.MatchString(evidence.HistoryStartHash) || !candidateHash.MatchString(evidence.RPCSources.PrimaryEndpointHash) || !candidateHash.MatchString(evidence.RPCSources.IndependentEndpointHash) || evidence.RPCSources.PrimaryEndpointHash == evidence.RPCSources.IndependentEndpointHash {
		return PublicationEvidence{}, ErrPublicationAssembly
	}
	previous := ""
	marketIndex := make(map[string]MarketReadModel, len(snapshot.Markets))
	for _, market := range snapshot.Markets {
		marketIndex[market.MarketID] = market
	}
	for _, holder := range evidence.ContinuousHolderEvidence {
		market, ok := marketIndex[holder.MarketID]
		start, startErr := Height(holder.StartBlockNumber)
		marketStart, marketStartErr := Height(market.Source.BlockNumber)
		if !ok || startErr != nil || marketStartErr != nil || start != marketStart || start < evidence.HistoryStartBlock || holder.StartBlockHash != market.Source.BlockHash || holder.Token != market.MemeToken ||
			!candidateHash.MatchString(holder.MarketID) || !candidateAddress.MatchString(holder.Token) || !candidateAddress.MatchString(holder.Distributor) || holder.MarketID <= previous || !publicationSHA256.MatchString(holder.AuditDigest) || !publicationDigest.MatchString(holder.ScopeDigest) || holder.CheckpointCount < 1 || holder.AccountsChecked < 1 || !publicationSHA256.MatchString(holder.AccountInventoryDigest) || !candidateHash.MatchString(holder.StartBlockHash) || !candidateHash.MatchString(holder.HeadBlockHash) || holder.HeadBlockNumber != evidence.CandidateBlockNumber || holder.HeadBlockHash != evidence.CandidateBlockHash {
			return PublicationEvidence{}, ErrPublicationAssembly
		}
		previous = holder.MarketID
	}
	canonical, err := json.Marshal(evidence)
	if err != nil || !bytes.Equal(canonical, raw) {
		return PublicationEvidence{}, ErrPublicationAssembly
	}
	return evidence, nil
}
