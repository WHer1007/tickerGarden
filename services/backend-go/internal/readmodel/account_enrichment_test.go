package readmodel

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestAccountEnrichment(t *testing.T) {
	for _, mode := range []string{"valid", "idempotent", "different block", "different chain", "missing roots", "missing inventory", "missing bindings", "different configs", "different positions", "conflicting account", "missing position account"} {
		t.Run(mode, func(t *testing.T) {
			snapshot := accountFixture(t)
			expected := *snapshot.Accounts
			candidate := CandidateSet{ChainID: snapshot.Sync.ChainID, BlockNumber: *snapshot.Sync.BlockNumber, BlockHash: *snapshot.Sync.BlockHash, HistoryReceiptRootsVerified: true, ProtocolEventInventoryVerified: true, EmitterAddressBindingsVerified: true, Configs: snapshot.Configs, Positions: snapshot.Positions}
			for _, a := range expected {
				candidate.Accounts = append(candidate.Accounts, AccountCandidate{User: a.User, AssetUID: a.AssetUID, Vault: a.Vault, Deposited: a.Deposited, Allocated: a.Allocated, Free: a.Free, Source: a.Source})
			}
			snapshot.Accounts = nil
			switch mode {
			case "idempotent":
				snapshot.Accounts = &expected
			case "different block":
				candidate.BlockNumber = "999"
			case "different chain":
				candidate.ChainID++
			case "missing roots":
				candidate.HistoryReceiptRootsVerified = false
			case "missing inventory":
				candidate.ProtocolEventInventoryVerified = false
			case "missing bindings":
				candidate.EmitterAddressBindingsVerified = false
			case "different configs":
				candidate.Configs = nil
			case "different positions":
				candidate.Positions = nil
			case "conflicting account":
				snapshot.Accounts = &expected
				candidate.Accounts[1].Deposited = "10"
				candidate.Accounts[1].Free = "10"
			case "missing position account":
				candidate.Accounts = candidate.Accounts[1:]
			}
			data, err := enrichCandidateAccounts(snapshot, candidate)
			if mode != "valid" && mode != "idempotent" {
				if err == nil || data != nil {
					t.Fatal("accepted inconsistent enrichment")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			got, err := Parse(data, snapshot.Sync.ChainID)
			if err != nil || got.Accounts == nil || !reflect.DeepEqual(*got.Accounts, expected) {
				t.Fatal("lost account principal", err)
			}
			if !reflect.DeepEqual(got.Sync, snapshot.Sync) || !reflect.DeepEqual(got.Positions, snapshot.Positions) || !reflect.DeepEqual(got.Markets, snapshot.Markets) {
				t.Fatal("enrichment changed producer state")
			}
		})
	}
}

func TestAccountEnrichmentAfterProducerJSONTransport(t *testing.T) {
	batch, sources := fullCandidateFixture(t)
	candidate, err := BuildCandidateSet(batch, sources)
	if err != nil {
		t.Fatal(err)
	}
	// Synthetic evidence flags exercise assembly only, not publication eligibility.
	candidate.HistoryReceiptRootsVerified = true
	candidate.ProtocolEventInventoryVerified = true
	candidate.EmitterAddressBindingsVerified = true
	snapshot := accountFixture(t)
	snapshot.Accounts = nil
	snapshot.Configs = candidate.Configs
	snapshot.Markets = candidate.Markets
	snapshot.Positions = candidate.Positions
	snapshot.Sync.ChainID = candidate.ChainID
	snapshot.Sync.BlockNumber = &candidate.BlockNumber
	snapshot.Sync.BlockHash = &candidate.BlockHash
	snapshot.Sync.HeadBlockNumber = &candidate.BlockNumber
	snapshot.Sync.HeadBlockHash = &candidate.BlockHash
	snapshot.Sync.Revision = candidate.BlockNumber + ":" + candidate.BlockHash
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := Parse(data, candidate.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = enrichCandidateAccounts(parsed, candidate); err != nil {
		t.Fatal(err)
	}
}

func TestAccountConfigWireComparisonPreservesNumbers(t *testing.T) {
	config := func(value any) []ConfigReadModel { return []ConfigReadModel{{Values: map[string]any{"value": value}}} }
	if !sameAccountConfigs(config(uint64(9007199254740993)), config(json.Number("9007199254740993"))) {
		t.Fatal("lossless decoded number rejected")
	}
	for _, value := range []any{json.Number("9007199254740992"), "9007199254740993", json.Number("invalid")} {
		if sameAccountConfigs(config(uint64(9007199254740993)), config(value)) {
			t.Fatal("different or invalid value accepted", value)
		}
	}
}
