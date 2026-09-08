package readmodel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
)

// EnrichAccounts attaches locally replayed principal to trusted producer output.
// It does not authorize publication or replace independent financial verification.
func (s *ObservationStore) EnrichAccounts(ctx context.Context, data []byte) ([]byte, error) {
	snapshot, err := Parse(data, s.ChainID)
	if err != nil {
		return nil, err
	}
	candidate, err := s.LoadCandidateSet(ctx)
	if err != nil {
		return nil, err
	}
	return enrichCandidateAccounts(snapshot, candidate)
}

func enrichCandidateAccounts(snapshot Snapshot, candidate CandidateSet) ([]byte, error) {
	bad := errors.New("account enrichment requires matching verified candidate coverage")
	if snapshot.Sync.BlockNumber == nil || snapshot.Sync.BlockHash == nil ||
		snapshot.Sync.ChainID != candidate.ChainID || *snapshot.Sync.BlockNumber != candidate.BlockNumber || *snapshot.Sync.BlockHash != candidate.BlockHash ||
		!candidate.HasVerifiedHistory() || !candidate.ProtocolEventInventoryVerified || !candidate.EmitterAddressBindingsVerified ||
		!sameAccountConfigs(snapshot.Configs, candidate.Configs) || !reflect.DeepEqual(snapshot.Positions, candidate.Positions) {
		return nil, bad
	}
	accounts := make([]UserAccountReadModel, len(candidate.Accounts))
	for i, a := range candidate.Accounts {
		accounts[i] = UserAccountReadModel{User: a.User, AssetUID: a.AssetUID, Vault: a.Vault, Deposited: a.Deposited, Allocated: a.Allocated, Free: a.Free, Source: a.Source}
	}
	// Never silently replace producer supplied principal with different values.
	if snapshot.Accounts != nil && !reflect.DeepEqual(*snapshot.Accounts, accounts) {
		return nil, bad
	}
	snapshot.Accounts = &accounts
	data, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	if _, err = Parse(data, snapshot.Sync.ChainID); err != nil {
		return nil, err
	}
	return data, nil
}

// Config Values carry JSON numbers, whose Go representation changes on decode.
// Compare their canonical wire encoding without float conversion or rounding.
func sameAccountConfigs(a, b []ConfigReadModel) bool {
	left, err := json.Marshal(a)
	if err != nil {
		return false
	}
	right, err := json.Marshal(b)
	return err == nil && bytes.Equal(left, right)
}
