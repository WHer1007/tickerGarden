package holderledger

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"

	"tickergarden/backend/internal/chainrpc"
)

type SeedRPCSnapshot struct {
	ChainID      uint64                               `json:"chainId"`
	Headers      map[string]chainrpc.Header           `json:"headers"`
	Codes        map[string]string                    `json:"codes"`
	Calls        map[string]string                    `json:"calls"`
	Transactions map[string]chainrpc.TransactionBlock `json:"transactions"`
	Observations map[string]chainrpc.Observation      `json:"observations"`
}

type SeedEvidence struct {
	Version int               `json:"version"`
	Config  SeedConfig        `json:"config"`
	Block   chainrpc.Header   `json:"block"`
	Report  AuthenticatedSeed `json:"report"`
	RPC     SeedRPCSnapshot   `json:"rpc"`
}

type seedCaptureRPC struct {
	SeedRPC
	snapshot SeedRPCSnapshot
	invalid  bool
}

func newSeedCaptureRPC(rpc SeedRPC) *seedCaptureRPC {
	return &seedCaptureRPC{SeedRPC: rpc, snapshot: SeedRPCSnapshot{Headers: map[string]chainrpc.Header{}, Codes: map[string]string{}, Calls: map[string]string{}, Transactions: map[string]chainrpc.TransactionBlock{}, Observations: map[string]chainrpc.Observation{}}}
}

func (c *seedCaptureRPC) ChainID(ctx context.Context) (uint64, error) {
	value, err := c.SeedRPC.ChainID(ctx)
	if err == nil {
		if c.snapshot.ChainID != 0 && c.snapshot.ChainID != value {
			c.invalid = true
		}
		c.snapshot.ChainID = value
	}
	return value, err
}

func (c *seedCaptureRPC) Header(ctx context.Context, tag string) (chainrpc.Header, error) {
	value, err := c.SeedRPC.Header(ctx, tag)
	if err == nil {
		if old, ok := c.snapshot.Headers[tag]; ok && old != value {
			c.invalid = true
		}
		c.snapshot.Headers[tag] = value
	}
	return value, err
}

func (c *seedCaptureRPC) CodeAt(ctx context.Context, address, blockHash string) ([]byte, error) {
	value, err := c.SeedRPC.CodeAt(ctx, address, blockHash)
	if err == nil {
		key := address + "@" + blockHash
		encoded := "0x" + hex.EncodeToString(value)
		if old, ok := c.snapshot.Codes[key]; ok && old != encoded {
			c.invalid = true
		}
		c.snapshot.Codes[key] = encoded
	}
	return value, err
}

func (c *seedCaptureRPC) CallAt(ctx context.Context, address, data, blockHash string) ([]byte, error) {
	value, err := c.SeedRPC.CallAt(ctx, address, data, blockHash)
	if err == nil {
		key := address + ":" + data + "@" + blockHash
		encoded := "0x" + hex.EncodeToString(value)
		if old, ok := c.snapshot.Calls[key]; ok && old != encoded {
			c.invalid = true
		}
		c.snapshot.Calls[key] = encoded
	}
	return value, err
}

func (c *seedCaptureRPC) AuthenticatedTransactions(ctx context.Context, chainID uint64, hash string) (chainrpc.TransactionBlock, error) {
	value, err := c.SeedRPC.AuthenticatedTransactions(ctx, chainID, hash)
	if err == nil {
		key := fmt.Sprintf("%d@%s", chainID, hash)
		if old, ok := c.snapshot.Transactions[key]; ok && !reflect.DeepEqual(old, value) {
			c.invalid = true
		}
		c.snapshot.Transactions[key] = value
	}
	return value, err
}

func (c *seedCaptureRPC) Observe(ctx context.Context, block chainrpc.Header) (chainrpc.Observation, error) {
	value, err := c.SeedRPC.Observe(ctx, block)
	if err == nil {
		if old, ok := c.snapshot.Observations[block.Hash]; ok && !reflect.DeepEqual(old, value) {
			c.invalid = true
		}
		c.snapshot.Observations[block.Hash] = value
	}
	return value, err
}

// AuthenticatePristineSeedWithEvidence retains every hash-pinned state read and
// the raw transaction/receipt-root bundles needed to repeat seed authentication.
func AuthenticatePristineSeedWithEvidence(ctx context.Context, rpc SeedRPC, config SeedConfig, block chainrpc.Header) (*Ledger, AuthenticatedSeed, SeedEvidence, error) {
	capture := newSeedCaptureRPC(rpc)
	ledger, report, err := authenticatePristineSeed(ctx, capture, config, block)
	if err != nil || capture.invalid {
		return nil, AuthenticatedSeed{}, SeedEvidence{}, ErrSeedAuthentication
	}
	evidence := SeedEvidence{Version: 1, Config: config, Block: block, Report: report, RPC: capture.snapshot}
	verified, verifiedReport, raw, _, err := verifySeedEvidence(ctx, evidence)
	if err != nil {
		return nil, AuthenticatedSeed{}, SeedEvidence{}, err
	}
	want, wantErr := EncodeCheckpoint(ledger)
	got, gotErr := EncodeCheckpoint(verified)
	if wantErr != nil || gotErr != nil || !bytes.Equal(want, got) || verifiedReport != report || len(raw) == 0 {
		return nil, AuthenticatedSeed{}, SeedEvidence{}, ErrSeedAuthentication
	}
	return ledger, report, evidence, nil
}

func verifySeedEvidence(ctx context.Context, evidence SeedEvidence) (*Ledger, AuthenticatedSeed, []byte, string, error) {
	fail := func() (*Ledger, AuthenticatedSeed, []byte, string, error) {
		return nil, AuthenticatedSeed{}, nil, "", ErrSeedAuthentication
	}
	if evidence.Version != 1 || evidence.Report.Block != evidence.Block || evidence.RPC.ChainID != evidence.Config.Scope.Config.ChainID {
		return fail()
	}
	transactionKey := fmt.Sprintf("%d@%s", evidence.Config.Scope.Config.ChainID, evidence.Block.Hash)
	transactions, ok := evidence.RPC.Transactions[transactionKey]
	observation, observed := evidence.RPC.Observations[evidence.Block.Hash]
	if !ok || !observed || len(transactions.RawBlock) == 0 || observation.RootProof == nil || observation.RootProof.Bundle == nil || validateTransactionObservation(transactions, observation, evidence.Block) != nil {
		return fail()
	}
	verifiedTransactions, err := chainrpc.VerifyTransactionBlock(transactions.RawBlock, evidence.Config.Scope.Config.ChainID, evidence.Block.Hash)
	if err != nil || verifiedTransactions.Header != transactions.Header || verifiedTransactions.ReceiptRoot != transactions.ReceiptRoot || !reflect.DeepEqual(verifiedTransactions.Transactions, transactions.Transactions) {
		return fail()
	}
	bundle := observation.RootProof.Bundle
	verifiedReceipts, err := chainrpc.VerifyReceiptRootBundle(bundle.Header, bundle.Receipts, evidence.Block.Hash)
	if err != nil || verifiedReceipts.BlockHash != observation.RootProof.BlockHash || verifiedReceipts.ReceiptRoot != observation.RootProof.ReceiptRoot || verifiedReceipts.ReceiptCount != observation.RootProof.ReceiptCount || verifiedReceipts.ReceiptSetHash != observation.RootProof.ReceiptSetHash {
		return fail()
	}
	raw, err := json.Marshal(evidence)
	if err != nil || len(raw) == 0 || len(raw) > maxReplayEvidenceBytes {
		return fail()
	}
	var canonical SeedEvidence
	if json.Unmarshal(raw, &canonical) != nil {
		return fail()
	}
	reencoded, err := json.Marshal(canonical)
	if err != nil || !bytes.Equal(raw, reencoded) {
		return fail()
	}
	offline := seedSnapshotRPC{snapshot: evidence.RPC}
	ledger, report, err := authenticatePristineSeed(ctx, offline, evidence.Config, evidence.Block)
	if err != nil || report != evidence.Report {
		return fail()
	}
	return ledger, report, raw, "sha256:" + checkpointDigest(raw), nil
}

type seedSnapshotRPC struct{ snapshot SeedRPCSnapshot }

func (r seedSnapshotRPC) ChainID(context.Context) (uint64, error) { return r.snapshot.ChainID, nil }
func (r seedSnapshotRPC) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	value, ok := r.snapshot.Headers[tag]
	if !ok {
		return chainrpc.Header{}, ErrSeedAuthentication
	}
	return value, nil
}
func (r seedSnapshotRPC) CodeAt(_ context.Context, address, blockHash string) ([]byte, error) {
	value, ok := r.snapshot.Codes[address+"@"+blockHash]
	if !ok || len(value) < 2 || value[:2] != "0x" {
		return nil, ErrSeedAuthentication
	}
	decoded, err := hex.DecodeString(value[2:])
	if err != nil {
		return nil, ErrSeedAuthentication
	}
	return decoded, nil
}
func (r seedSnapshotRPC) CallAt(_ context.Context, address, data, blockHash string) ([]byte, error) {
	value, ok := r.snapshot.Calls[address+":"+data+"@"+blockHash]
	if !ok || len(value) < 2 || value[:2] != "0x" {
		return nil, ErrSeedAuthentication
	}
	decoded, err := hex.DecodeString(value[2:])
	if err != nil {
		return nil, ErrSeedAuthentication
	}
	return decoded, nil
}
func (r seedSnapshotRPC) AuthenticatedTransactions(_ context.Context, chainID uint64, hash string) (chainrpc.TransactionBlock, error) {
	value, ok := r.snapshot.Transactions[fmt.Sprintf("%d@%s", chainID, hash)]
	if !ok {
		return chainrpc.TransactionBlock{}, ErrSeedAuthentication
	}
	return value, nil
}
func (r seedSnapshotRPC) Observe(_ context.Context, block chainrpc.Header) (chainrpc.Observation, error) {
	value, ok := r.snapshot.Observations[block.Hash]
	if !ok {
		return chainrpc.Observation{}, ErrSeedAuthentication
	}
	return value, nil
}
