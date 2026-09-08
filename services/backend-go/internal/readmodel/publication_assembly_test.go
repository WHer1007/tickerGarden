package readmodel

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/feeledger"
	"tickergarden/backend/internal/holderledger"
)

func completePublicationChecks() PublicationChecks {
	return PublicationChecks{PrimaryRPCVerified: true, IndependentRPCVerified: true, HistoryOriginVerified: true, CandidateReceiptRootVerified: true, StaticRuntimeVerified: true, AssetIdentitiesVerified: true, VaultPrincipalVerified: true, MarketRoutesVerified: true, CurveProgressVerified: true, ConfigValuesVerified: true, GaugePositionsVerified: true, FeeLiabilitiesVerified: true, CreatorLiabilitiesVerified: true, HolderLiabilitiesVerified: true, TreasuryArtifactsVerified: true}
}

func publicationRPCSources() PublicationRPCSources {
	return PublicationRPCSources{PrimaryEndpointHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", IndependentEndpointHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
}

func emptyPublishableCandidate() CandidateSet {
	blockHash := "0x1111111111111111111111111111111111111111111111111111111111111111"
	startHash := "0x2222222222222222222222222222222222222222222222222222222222222222"
	report := feeledger.Report{Scope: "fee-liabilities-v1", MatchesKnownLiabilities: true, Probes: []feeledger.Probe{}, Unexpected: []string{}}
	return CandidateSet{ChainID: 46630, BlockNumber: "10", BlockHash: blockHash, HistoryStartBlock: 1, HistoryStartHash: startHash, HistoryReceiptRootsVerified: true, TreasuryClaimHistoryVerified: true, ServiceCreditHistoryVerified: true, ProtocolEventInventoryVerified: true, EmitterAddressBindingsVerified: true, FeeReconciliation: &FeeReconciliationCandidate{Status: "matched", ChainID: 46630, StartBlock: 1, BlockNumber: "10", BlockHash: blockHash, Report: &report}, FeeClaims: []FeeClaimCandidate{}, TreasuryClaims: []TreasuryClaimCandidate{}, ServiceCredits: []ServiceCreditCandidate{}, HolderMarkets: []HolderMarketCandidate{}, CreatorEpochs: []CreatorEpochCandidate{}, Accounts: []AccountCandidate{}, Markets: []MarketReadModel{}, Configs: []ConfigReadModel{}, Positions: []UserPositionReadModel{}}
}

func minimalPublishableCandidate() (CandidateSet, chainrpc.Header) {
	candidate, head, _ := continuousHolderPublicationFixture()
	candidate.HolderMarkets = []HolderMarketCandidate{}
	return candidate, head
}

func TestMinimalPublishableCandidateCarriesFeeAndSourceProvenance(t *testing.T) {
	candidate, _ := minimalPublishableCandidate()
	fee := candidate.FeeReconciliation
	if fee == nil || fee.Report == nil || len(fee.Report.Probes) == 0 || fee.Report.Expected != len(fee.Report.Probes) || fee.Report.Completed != len(fee.Report.Probes) {
		t.Fatalf("minimal fixture fee report is incomplete: %+v", fee)
	}
	if fee.ChainID != candidate.ChainID || fee.StartBlock != candidate.HistoryStartBlock || fee.BlockNumber != candidate.BlockNumber || fee.BlockHash != candidate.BlockHash {
		t.Fatalf("minimal fixture fee provenance mismatch: fee=%+v candidate=%+v", fee, candidate)
	}
	if len(candidate.Markets) != 1 {
		t.Fatalf("minimal fixture market inventory=%d", len(candidate.Markets))
	}
	source := candidate.Markets[0].Source
	if source.ChainID != candidate.ChainID || source.BlockNumber != "1" || source.BlockHash != "0x"+strings.Repeat("5", 64) || source.TransactionHash == "" {
		t.Fatalf("minimal fixture market source is not pinned: %+v", source)
	}
}

func TestAssemblePublicationAllowsVerifiedZeroMarketCandidate(t *testing.T) {
	candidate := emptyPublishableCandidate()
	actual := "0"
	candidate.FeeReconciliation.Report.Probes = []feeledger.Probe{{Kind: "feeLiability", Key: "zero-market", Field: "creator", Expected: "0", Actual: &actual, Comparison: "equal", Status: "matched"}}
	candidate.FeeReconciliation.Report.Expected = 1
	candidate.FeeReconciliation.Report.Completed = 1
	head := chainrpc.Header{Number: "0xa", Hash: candidate.BlockHash, ParentHash: "0x3333333333333333333333333333333333333333333333333333333333333333", Timestamp: "0x64"}
	manifest := "0x4444444444444444444444444444444444444444444444444444444444444444"
	snapshotRaw, evidenceRaw, err := AssemblePublication(candidate, manifest, head, publicationRPCSources(), completePublicationChecks(), nil)
	if err != nil || len(snapshotRaw) == 0 || len(evidenceRaw) == 0 {
		t.Fatal("rejected verified zero-market publication candidate", err)
	}
}

func TestAssemblePublicationRejectsZeroMarketWithoutHistoryEvidence(t *testing.T) {
	candidate := emptyPublishableCandidate()
	actual := "0"
	candidate.FeeReconciliation.Report.Probes = []feeledger.Probe{{Kind: "feeLiability", Key: "zero-market", Field: "creator", Expected: "0", Actual: &actual, Comparison: "equal", Status: "matched"}}
	candidate.FeeReconciliation.Report.Expected = 1
	candidate.FeeReconciliation.Report.Completed = 1
	head := chainrpc.Header{Number: "0xa", Hash: candidate.BlockHash, ParentHash: "0x3333333333333333333333333333333333333333333333333333333333333333", Timestamp: "0x64"}
	candidate.HistoryReceiptRootsVerified = false
	manifest := "0x4444444444444444444444444444444444444444444444444444444444444444"
	if snapshot, evidence, err := AssemblePublication(candidate, manifest, head, publicationRPCSources(), completePublicationChecks(), nil); err == nil || snapshot != nil || evidence != nil {
		t.Fatal("accepted zero-market candidate without verified history")
	}
}

func TestAssemblePublicationRejectsMalformedFeeReport(t *testing.T) {
	mutations := []struct {
		name   string
		mutate func(*feeledger.Report)
	}{
		{name: "unverified", mutate: func(report *feeledger.Report) { report.MatchesKnownLiabilities = false }},
		{name: "wrong count", mutate: func(report *feeledger.Report) { report.Expected++ }},
		{name: "incomplete", mutate: func(report *feeledger.Report) { report.Completed = 0 }},
		{name: "missing actual", mutate: func(report *feeledger.Report) { report.Probes[0].Actual = nil }},
		{name: "false matched status", mutate: func(report *feeledger.Report) { value := "1"; report.Probes[0].Actual = &value }},
		{name: "noncanonical amount", mutate: func(report *feeledger.Report) { report.Probes[0].Expected = "00" }},
		{name: "invalid comparison", mutate: func(report *feeledger.Report) { report.Probes[0].Comparison = "eq" }},
	}
	for _, tc := range mutations {
		t.Run(tc.name, func(t *testing.T) {
			candidate, head := minimalPublishableCandidate()
			tc.mutate(candidate.FeeReconciliation.Report)
			snapshot, evidence, err := AssemblePublication(candidate, "0x"+strings.Repeat("4", 64), head, publicationRPCSources(), completePublicationChecks(), nil)
			if err == nil || snapshot != nil || evidence != nil {
				t.Fatal("accepted malformed fee publication report")
			}
		})
	}
}

func TestAssemblePublicationAcceptsCanonicalNumericConfigRoundTrip(t *testing.T) {
	candidate, head := minimalPublishableCandidate()
	batch, source, id := quoteCandidateFixture(t)
	config, err := BuildConfigCandidate(batch, "quote", id, source)
	if err != nil {
		t.Fatal(err)
	}
	// Config Values deliberately contains uint64 fields. Parse decodes open map
	// numbers as json.Number, so structural Go type equality is not canonicality.
	candidate.Configs = []ConfigReadModel{config}
	snapshot, evidence, err := AssemblePublication(candidate, "0x"+strings.Repeat("4", 64), head, publicationRPCSources(), completePublicationChecks(), nil)
	if err != nil || len(snapshot) == 0 || len(evidence) == 0 {
		t.Fatal("canonical numeric configuration could not be published", err)
	}
}

func TestPublicationEvidenceRejectsMutation(t *testing.T) {
	candidate, head := minimalPublishableCandidate()
	snapshotRaw, evidenceRaw, err := AssemblePublication(candidate, "0x4444444444444444444444444444444444444444444444444444444444444444", head, publicationRPCSources(), completePublicationChecks(), nil)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, _ := Parse(snapshotRaw, candidate.ChainID)
	var evidence PublicationEvidence
	if json.Unmarshal(evidenceRaw, &evidence) != nil {
		t.Fatal("cannot decode fixture evidence")
	}
	evidence.Checks.PrimaryRPCVerified = false
	mutated, _ := json.Marshal(evidence)
	if parsed, err := parsePublicationEvidence(mutated, snapshot); err == nil || !reflect.DeepEqual(parsed, PublicationEvidence{}) {
		t.Fatal("accepted mutated evidence")
	}
}

func continuousHolderPublicationFixture() (CandidateSet, chainrpc.Header, []HolderPublicationBinding) {
	candidate := emptyPublishableCandidate()
	marketID := "0x" + strings.Repeat("c", 64)
	token := "0x" + strings.Repeat("d", 40)
	quote := "0x" + strings.Repeat("e", 40)
	distributor := "0x" + strings.Repeat("f", 40)
	vault := "0x" + strings.Repeat("1", 40)
	genesisHash := "0x" + strings.Repeat("2", 64)
	tokenCodeHash := "0x" + strings.Repeat("3", 64)
	distributorCodeHash := "0x" + strings.Repeat("4", 64)
	startHash := "0x" + strings.Repeat("5", 64)
	parentHash := "0x" + strings.Repeat("6", 64)
	creatorEpochReport := &CreatorEpochReconciliation{Status: "matched", Probes: []CreatorEpochProbe{
		{MarketID: marketID, Epoch: "1", Asset: quote, Expected: "0", Actual: "0", Status: "matched"},
		{MarketID: marketID, Epoch: "1", Asset: token, Expected: "0", Actual: "0", Status: "matched"},
	}}
	config := holderledger.ReconcileConfig{
		ChainID: candidate.ChainID, GenesisHash: genesisHash, Quote: quote,
		TokenCodeHash: tokenCodeHash, DistributorCodeHash: distributorCodeHash, MaxAccounts: 10,
		Binding: holderledger.Binding{Distributor: distributor, Vault: vault},
	}
	candidate.Markets = []MarketReadModel{{
		MarketID: marketID, AssetUID: "0x" + strings.Repeat("7", 64), MemeToken: token,
		Curve: "0x" + strings.Repeat("8", 40), Gauge: "0x" + strings.Repeat("9", 40), QuoteAsset: quote,
		QuoteAssetConfigID: "0x" + strings.Repeat("a", 64), TickerGardenBaselineID: "0x" + strings.Repeat("b", 64),
		SourceVersion:  1,
		CanonicalRoute: CanonicalRoute{Router: "0x" + strings.Repeat("1", 40), Quoter: "0x" + strings.Repeat("2", 40), Hook: "0x" + strings.Repeat("3", 40), LaunchLocker: "0x" + strings.Repeat("4", 40), GraduationExecutor: "0x" + strings.Repeat("5", 40), CurveTradingEnabled: true, SourceVersion: 1, LaunchPhase: 0},
		CurveProgress:  CurveProgress{RealQuoteReserve: "0", SellableTokens: "0", ReservedTokens: "0", AccruedCurveFees: "0"},
		Source:         SourceBlock{ChainID: candidate.ChainID, BlockNumber: "1", BlockHash: startHash, TransactionHash: "0x" + strings.Repeat("c", 64)},
	}}
	actual := "0"
	candidate.FeeReconciliation.Report.Probes = []feeledger.Probe{{Kind: "feeLiability", Key: marketID + ":" + quote, Field: "creator", Expected: "0", Actual: &actual, Comparison: "equal", Status: "matched"}}
	candidate.FeeReconciliation.Report.Expected = 1
	candidate.FeeReconciliation.Report.Completed = 1
	candidate.CreatorEpochs = []CreatorEpochCandidate{{
		MarketID: marketID, Epoch: "1", Beneficiary: distributor,
		QuoteAsset: quote, MemeAsset: token, QuoteLiability: "0", MemeLiability: "0",
	}}
	candidate.FeeReconciliation.CreatorEpochs = creatorEpochReport
	scope := holderledger.CheckpointScope{Config: config, MarketID: marketID, Token: token}
	scopeDigest, _ := holderledger.ScopeDigest(scope)
	head := chainrpc.Header{Number: "0xa", Hash: candidate.BlockHash, ParentHash: parentHash, Timestamp: "0x64"}
	audit := holderledger.CheckpointAudit{
		ScopeDigest: scopeDigest, Revisions: 1,
		Start: chainrpc.Header{Number: "0x1", Hash: startHash, ParentHash: genesisHash, Timestamp: "0x1"},
		Head:  head, AuthenticatedSeed: true, CheckpointChainValid: true,
		RawRootsReverified: true, EvidenceReplayValid: true,
		EvidenceDigest: "sha256:" + strings.Repeat("a", 64),
	}
	reconciliation := holderledger.Reconciliation{
		Block: head, MarketID: marketID, AccountsChecked: 2,
		FieldsMatched: true, Differences: []string{}, DifferenceCount: 0,
		AccountInventoryDigest: "sha256:" + strings.Repeat("9", 64),
	}
	candidate.HolderMarkets = []HolderMarketCandidate{{
		MarketID: marketID, Distributor: distributor, MemeToken: token, QuoteAsset: quote,
		Mode: "continuous-24h", Continuous: &ContinuousHolderCandidate{},
	}}
	binding := HolderPublicationBinding{
		Scope: scope, Audit: audit,
		PrimaryReconciliation: reconciliation, IndependentReconciliation: reconciliation,
	}
	return candidate, head, []HolderPublicationBinding{binding}
}

func TestAssemblePublicationRequiresCompleteContinuousHolderBinding(t *testing.T) {
	manifest := "0x" + strings.Repeat("7", 64)
	sources := publicationRPCSources()
	checks := completePublicationChecks()
	mutations := []struct {
		name   string
		mutate func(*HolderPublicationBinding)
	}{
		{name: "missing binding", mutate: nil},
		{name: "scope mismatch", mutate: func(b *HolderPublicationBinding) { b.Scope.MarketID = "0x" + strings.Repeat("8", 64) }},
		{name: "token mismatch", mutate: func(b *HolderPublicationBinding) { b.Scope.Token = "0x" + strings.Repeat("9", 40) }},
		{name: "distributor mismatch", mutate: func(b *HolderPublicationBinding) { b.Scope.Config.Binding.Distributor = "0x" + strings.Repeat("a", 40) }},
		{name: "head mismatch", mutate: func(b *HolderPublicationBinding) { b.Audit.Head.Hash = "0x" + strings.Repeat("b", 64) }},
		{name: "audit start mismatch", mutate: func(b *HolderPublicationBinding) { b.Audit.Start.Hash = "0x" + strings.Repeat("b", 64) }},
		{name: "audit digest mismatch", mutate: func(b *HolderPublicationBinding) { b.Audit.ScopeDigest = "deadbeef" }},
		{name: "primary reconciliation difference", mutate: func(b *HolderPublicationBinding) { b.PrimaryReconciliation.DifferenceCount = 1 }},
		{name: "independent reconciliation difference", mutate: func(b *HolderPublicationBinding) { b.IndependentReconciliation.Differences = []string{"balance"} }},
		{name: "account count mismatch", mutate: func(b *HolderPublicationBinding) { b.IndependentReconciliation.AccountsChecked = 3 }},
		{name: "account inventory digest mismatch", mutate: func(b *HolderPublicationBinding) {
			b.IndependentReconciliation.AccountInventoryDigest = "sha256:" + strings.Repeat("8", 64)
		}},
	}

	for _, tc := range mutations {
		t.Run(tc.name, func(t *testing.T) {
			candidate, head, bindings := continuousHolderPublicationFixture()
			if tc.mutate == nil {
				bindings = nil
			} else {
				tc.mutate(&bindings[0])
			}
			snapshot, evidence, err := AssemblePublication(candidate, manifest, head, sources, checks, bindings)
			if err == nil || snapshot != nil || evidence != nil {
				t.Fatalf("accepted incomplete continuous Holder binding: err=%v", err)
			}
		})
	}

	candidate, head, bindings := continuousHolderPublicationFixture()
	snapshot, evidence, err := AssemblePublication(candidate, manifest, head, sources, checks, bindings)
	if err != nil || snapshot == nil || evidence == nil {
		t.Fatalf("rejected complete continuous Holder binding: err=%v", err)
	}
	parsed, err := Parse(snapshot, candidate.ChainID)
	if err != nil || parsed.Sync.Revision != candidate.BlockNumber+":"+candidate.BlockHash {
		t.Fatalf("invalid complete Holder snapshot: %+v %v", parsed, err)
	}
	decoded, err := parsePublicationEvidence(evidence, parsed)
	if err != nil || len(decoded.ContinuousHolderEvidence) != 1 || decoded.ContinuousHolderEvidence[0].AccountsChecked != 2 {
		t.Fatalf("invalid complete Holder evidence: %+v %v", decoded, err)
	}
}

func TestPublicationEvidenceRejectsDurableHolderMutations(t *testing.T) {
	candidate, head, bindings := continuousHolderPublicationFixture()
	manifest := "0x" + strings.Repeat("7", 64)
	snapshotRaw, evidenceRaw, err := AssemblePublication(candidate, manifest, head, publicationRPCSources(), completePublicationChecks(), bindings)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := Parse(snapshotRaw, candidate.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	mutations := []struct {
		name   string
		mutate func(*HolderPublicationEvidence)
	}{
		{name: "start block number changed", mutate: func(h *HolderPublicationEvidence) { h.StartBlockNumber = "2" }},
		{name: "invalid sha256 digest", mutate: func(h *HolderPublicationEvidence) { h.AuditDigest = "sha256:" + strings.Repeat("g", 64) }},
		{name: "token differs from market", mutate: func(h *HolderPublicationEvidence) { h.Token = "0x" + strings.Repeat("8", 40) }},
	}
	for _, tc := range mutations {
		t.Run(tc.name, func(t *testing.T) {
			var evidence PublicationEvidence
			if err := json.Unmarshal(evidenceRaw, &evidence); err != nil {
				t.Fatal(err)
			}
			tc.mutate(&evidence.ContinuousHolderEvidence[0])
			mutated, err := json.Marshal(evidence)
			if err != nil {
				t.Fatal(err)
			}
			if parsed, err := parsePublicationEvidence(mutated, snapshot); err == nil || !reflect.DeepEqual(parsed, PublicationEvidence{}) {
				t.Fatalf("accepted durable evidence mutation: parsed=%+v err=%v", parsed, err)
			}
		})
	}
}
