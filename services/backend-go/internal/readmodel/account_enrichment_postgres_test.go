package readmodel

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
)

func testAccountEnrichmentPublication(t *testing.T, ctx context.Context, store ObservationStore, candidate CandidateSet, inputs []projection.Input, exec func(string, ...any)) {
	t.Helper()
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: store.ChainID, GenesisHash: store.GenesisHash}
	for _, input := range inputs {
		manifest.Contracts = append(manifest.Contracts, deployment.Contract{Module: input.Module, Address: input.Log.Address, RuntimeCodeHash: deployment.Hash([]byte(input.Module))})
	}
	oldHash := store.ManifestHash
	store.ManifestHash = candidateManifestHash(manifest)
	store.EmitterManifest = &manifest
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1`, store.ManifestHash)
	exec(`UPDATE tickergarden.projection_checkpoints SET manifest_hash=$1`, store.ManifestHash)
	// This fixture tests consumption of synthetic evidence, not RPC root generation.
	exec(`UPDATE tickergarden.chain_blocks SET receipts_root=$1,root_receipt_set_hash=receipt_set_hash WHERE canonical`, deployment.Hash([]byte("account enrichment fixture root")))
	defer func() {
		exec(`DELETE FROM tickergarden.read_snapshots`)
		exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1`, oldHash)
		exec(`UPDATE tickergarden.projection_checkpoints SET manifest_hash=$1`, oldHash)
		exec(`UPDATE tickergarden.chain_blocks SET receipts_root=NULL,root_receipt_set_hash=NULL`)
	}()
	verified, err := store.LoadCandidateSet(ctx)
	if err != nil || !verified.EmitterAddressBindingsVerified || !verified.ProtocolEventInventoryVerified || !verified.HistoryReceiptRootsVerified {
		t.Fatal("manifest-backed account candidate", err)
	}
	producer := accountFixture(t)
	producer.Accounts = nil
	producer.Configs, producer.Markets, producer.Positions = candidate.Configs, candidate.Markets, candidate.Positions
	producer.Sync.ChainID = candidate.ChainID
	producer.Sync.BlockNumber, producer.Sync.BlockHash = &candidate.BlockNumber, &candidate.BlockHash
	producer.Sync.HeadBlockNumber, producer.Sync.HeadBlockHash = &candidate.BlockNumber, &candidate.BlockHash
	producer.Sync.Revision = candidate.BlockNumber + ":" + candidate.BlockHash
	data, err := json.Marshal(producer)
	if err != nil {
		t.Fatal(err)
	}
	enriched, err := store.EnrichAccounts(ctx, data)
	if err != nil {
		t.Fatal("database account enrichment", err)
	}
	parsed, err := Parse(enriched, store.ChainID)
	if err != nil || parsed.Accounts == nil || len(*parsed.Accounts) != len(verified.Accounts) {
		t.Fatal("account coverage", err)
	}
	publisher := Store{Pool: store.Pool, ChainID: store.ChainID}
	if err := publisher.Publish(ctx, enriched, time.Now()); err != nil {
		t.Fatal("publish enriched principal", err)
	}
	loaded, err := publisher.Load(ctx, producer.Sync.Revision)
	if err != nil || loaded.Accounts == nil || !reflect.DeepEqual(*loaded.Accounts, *parsed.Accounts) {
		t.Fatal("read enriched principal", err)
	}
	if verified.PublicationEligible {
		t.Fatal("local enrichment promoted candidate eligibility")
	}
}
