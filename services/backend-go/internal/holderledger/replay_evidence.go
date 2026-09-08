package holderledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"

	"tickergarden/backend/internal/chainrpc"
)

var ErrReplayEvidence = errors.New("holder replay evidence unavailable or inconsistent")

const maxReplayEvidenceBytes = 384 << 20

type TransactionTrace struct {
	TransactionHash string             `json:"transactionHash"`
	Trace           chainrpc.CallTrace `json:"trace"`
}

type ReplayEvidence struct {
	Version      int                       `json:"version"`
	Parent       chainrpc.Header           `json:"parent"`
	Block        chainrpc.Header           `json:"block"`
	Config       ReconcileConfig           `json:"config"`
	Transactions chainrpc.TransactionBlock `json:"transactions"`
	Observation  chainrpc.Observation      `json:"observation"`
	Traces       []TransactionTrace        `json:"traces"`
}

type StoredEvidence struct {
	Version int             `json:"version"`
	Kind    string          `json:"kind"`
	Seed    *SeedEvidence   `json:"seed,omitempty"`
	Replay  *ReplayEvidence `json:"replay,omitempty"`
}

func encodeStoredEvidence(value StoredEvidence) ([]byte, string, error) {
	if value.Version != 1 || (value.Kind == "seed") != (value.Seed != nil) || (value.Kind == "replay") != (value.Replay != nil) || (value.Seed == nil) == (value.Replay == nil) {
		return nil, "", ErrReplayEvidence
	}
	raw, err := json.Marshal(value)
	if err != nil || len(raw) == 0 || len(raw) > maxReplayEvidenceBytes {
		return nil, "", ErrReplayEvidence
	}
	return raw, "sha256:" + checkpointDigest(raw), nil
}

func decodeStoredEvidence(raw []byte, digest string) (StoredEvidence, error) {
	var value StoredEvidence
	if len(raw) == 0 || len(raw) > maxReplayEvidenceBytes || digest != "sha256:"+checkpointDigest(raw) || json.Unmarshal(raw, &value) != nil {
		return StoredEvidence{}, ErrReplayEvidence
	}
	canonical, err := json.Marshal(value)
	if err != nil || !bytesEqual(raw, canonical) {
		return StoredEvidence{}, ErrReplayEvidence
	}
	if _, _, err = encodeStoredEvidence(value); err != nil {
		return StoredEvidence{}, err
	}
	return value, nil
}

type replayCaptureRPC struct {
	BlockReplayRPC
	transactions *chainrpc.TransactionBlock
	observation  *chainrpc.Observation
	traces       []TransactionTrace
	invalid      bool
}

func (c *replayCaptureRPC) AuthenticatedTransactions(ctx context.Context, chainID uint64, hash string) (chainrpc.TransactionBlock, error) {
	value, err := c.BlockReplayRPC.AuthenticatedTransactions(ctx, chainID, hash)
	if err == nil {
		if c.transactions != nil {
			c.invalid = true
		} else {
			copy := value
			c.transactions = &copy
		}
	}
	return value, err
}

func (c *replayCaptureRPC) Observe(ctx context.Context, block chainrpc.Header) (chainrpc.Observation, error) {
	value, err := c.BlockReplayRPC.Observe(ctx, block)
	if err == nil {
		if c.observation != nil {
			c.invalid = true
		} else {
			copy := value
			c.observation = &copy
		}
	}
	return value, err
}

func (c *replayCaptureRPC) TransactionCallTrace(ctx context.Context, hash string) (chainrpc.CallTrace, error) {
	value, err := c.BlockReplayRPC.TransactionCallTrace(ctx, hash)
	if err == nil {
		c.traces = append(c.traces, TransactionTrace{TransactionHash: hash, Trace: value})
	}
	return value, err
}

func (c *replayCaptureRPC) evidence(parent, block chainrpc.Header, config ReconcileConfig) (ReplayEvidence, error) {
	if c.invalid || c.transactions == nil || c.observation == nil || len(c.traces) != len(c.transactions.Transactions) {
		return ReplayEvidence{}, ErrReplayEvidence
	}
	return ReplayEvidence{Version: 1, Parent: parent, Block: block, Config: config, Transactions: *c.transactions, Observation: *c.observation, Traces: c.traces}, nil
}

func replayEvidenceDigest(parent, block chainrpc.Header, config ReconcileConfig, receiptSet string, ledger *Ledger, transactions []chainrpc.AuthenticatedTransaction, traces []TransactionTrace) (string, error) {
	digest := sha256.New()
	encoder := json.NewEncoder(digest)
	if encoder.Encode(struct {
		Parent, Block chainrpc.Header
		Config        ReconcileConfig
		ReceiptSet    string
	}{parent, block, config, receiptSet}) != nil || encoder.Encode(ledger) != nil || len(transactions) != len(traces) {
		return "", ErrReplayEvidence
	}
	for i, transaction := range transactions {
		if traces[i].TransactionHash != transaction.Hash || encoder.Encode(struct {
			Transaction chainrpc.AuthenticatedTransaction
			Trace       chainrpc.CallTrace
		}{transaction, traces[i].Trace}) != nil {
			return "", ErrReplayEvidence
		}
	}
	return "sha256:" + hex.EncodeToString(digest.Sum(nil)), nil
}

func validateReplayEvidence(e ReplayEvidence, requireRaw bool) ([]byte, string, error) {
	fail := func() ([]byte, string, error) { return nil, "", ErrReplayEvidence }
	if e.Version != 1 || e.Config.ChainID == 0 || !hash.MatchString(e.Config.GenesisHash) || !hash.MatchString(e.Config.TokenCodeHash) || !hash.MatchString(e.Config.DistributorCodeHash) || !address.MatchString(e.Config.Quote) || !address.MatchString(e.Config.Binding.Distributor) || !address.MatchString(e.Config.Binding.Vault) || e.Config.Binding.Distributor == zero || e.Config.Binding.Vault == zero || e.Config.Binding.Distributor == e.Config.Binding.Vault || e.Config.MaxAccounts < 1 || e.Config.MaxAccounts > 10000 || e.Transactions.Header != e.Block || e.Observation.RootProof == nil || e.Observation.RootProof.BlockHash != e.Block.Hash || e.Observation.RootProof.ReceiptRoot != e.Transactions.ReceiptRoot || e.Observation.RootProof.ReceiptCount != len(e.Transactions.Transactions) || len(e.Observation.Receipts) != len(e.Transactions.Transactions) || len(e.Traces) != len(e.Transactions.Transactions) {
		return fail()
	}
	parentHeight, parentErr := e.Parent.Height()
	height, heightErr := e.Block.Height()
	if parentErr != nil || heightErr != nil || height != parentHeight+1 || e.Block.ParentHash != e.Parent.Hash {
		return fail()
	}
	commitment, err := chainrpc.ReceiptSetCommitment(e.Observation.Receipts)
	if err != nil || commitment != e.Observation.RootProof.ReceiptSetHash {
		return fail()
	}
	if validateTransactionObservation(e.Transactions, e.Observation, e.Block) != nil {
		return fail()
	}
	flattened := make([]chainrpc.Log, 0, len(e.Observation.Logs))
	for i, transaction := range e.Transactions.Transactions {
		receipt := e.Observation.Receipts[i]
		if chainrpc.ValidateTransactionReceipt(transaction.Hash, &receipt) != nil || receipt.BlockHash != e.Block.Hash || receipt.BlockNumber != e.Block.Number || receipt.TransactionIndex != "0x"+strconv.FormatInt(int64(i), 16) || e.Traces[i].TransactionHash != transaction.Hash || chainrpc.ValidateCallTrace(e.Traces[i].Trace) != nil {
			return fail()
		}
		trace := e.Traces[i].Trace
		wantType := "CALL"
		if transaction.Creation {
			wantType = "CREATE"
		}
		value := trace.Value
		if value == "" {
			value = "0x0"
		}
		if trace.Type != wantType || trace.From != transaction.From || trace.To != transaction.To || trace.Input != transaction.Input || value != transaction.Value || (trace.Error == "") != (receipt.Status == "0x1") {
			return fail()
		}
		for _, log := range receipt.Logs {
			if log.BlockHash != e.Block.Hash || log.BlockNumber != e.Block.Number || log.TransactionHash != transaction.Hash || log.TransactionIndex != receipt.TransactionIndex || log.LogIndex != fmt.Sprintf("0x%x", len(flattened)) {
				return fail()
			}
			flattened = append(flattened, log)
		}
	}
	if len(flattened) != len(e.Observation.Logs) {
		return fail()
	}
	for i := range flattened {
		if !reflect.DeepEqual(flattened[i], e.Observation.Logs[i]) {
			return fail()
		}
	}
	rawAvailable := len(e.Transactions.RawBlock) > 0 && e.Observation.RootProof.Bundle != nil
	if requireRaw && !rawAvailable {
		return fail()
	}
	if rawAvailable {
		verifiedTransactions, verifyErr := chainrpc.VerifyTransactionBlock(e.Transactions.RawBlock, e.Config.ChainID, e.Block.Hash)
		if verifyErr != nil || verifiedTransactions.Header != e.Transactions.Header || verifiedTransactions.ReceiptRoot != e.Transactions.ReceiptRoot || !reflect.DeepEqual(verifiedTransactions.Transactions, e.Transactions.Transactions) {
			return fail()
		}
		bundle := e.Observation.RootProof.Bundle
		verifiedReceipts, verifyErr := chainrpc.VerifyReceiptRootBundle(bundle.Header, bundle.Receipts, e.Block.Hash)
		if verifyErr != nil || verifiedReceipts.BlockHash != e.Observation.RootProof.BlockHash || verifiedReceipts.ReceiptRoot != e.Observation.RootProof.ReceiptRoot || verifiedReceipts.ReceiptCount != e.Observation.RootProof.ReceiptCount || verifiedReceipts.ReceiptSetHash != e.Observation.RootProof.ReceiptSetHash {
			return fail()
		}
	}
	raw, err := json.Marshal(e)
	if err != nil || len(raw) == 0 || len(raw) > maxReplayEvidenceBytes {
		return fail()
	}
	var roundTrip ReplayEvidence
	if json.Unmarshal(raw, &roundTrip) != nil {
		return fail()
	}
	canonical, err := json.Marshal(roundTrip)
	if err != nil || !bytesEqual(raw, canonical) {
		return fail()
	}
	return raw, "sha256:" + checkpointDigest(raw), nil
}

func validateTransactionObservation(transactions chainrpc.TransactionBlock, observation chainrpc.Observation, block chainrpc.Header) error {
	if transactions.Header != block || observation.RootProof == nil || observation.RootProof.BlockHash != block.Hash || observation.RootProof.ReceiptRoot != transactions.ReceiptRoot || observation.RootProof.ReceiptCount != len(transactions.Transactions) || len(observation.Receipts) != len(transactions.Transactions) {
		return ErrReplayEvidence
	}
	commitment, err := chainrpc.ReceiptSetCommitment(observation.Receipts)
	if err != nil || commitment != observation.RootProof.ReceiptSetHash {
		return ErrReplayEvidence
	}
	flattened := make([]chainrpc.Log, 0, len(observation.Logs))
	for i, transaction := range transactions.Transactions {
		receipt := observation.Receipts[i]
		if chainrpc.ValidateTransactionReceipt(transaction.Hash, &receipt) != nil || receipt.BlockHash != block.Hash || receipt.BlockNumber != block.Number || receipt.TransactionIndex != fmt.Sprintf("0x%x", i) {
			return ErrReplayEvidence
		}
		for _, log := range receipt.Logs {
			if log.BlockHash != block.Hash || log.BlockNumber != block.Number || log.TransactionHash != transaction.Hash || log.TransactionIndex != receipt.TransactionIndex || log.LogIndex != fmt.Sprintf("0x%x", len(flattened)) {
				return ErrReplayEvidence
			}
			flattened = append(flattened, log)
		}
	}
	if len(flattened) != len(observation.Logs) {
		return ErrReplayEvidence
	}
	for i := range flattened {
		if !reflect.DeepEqual(flattened[i], observation.Logs[i]) {
			return ErrReplayEvidence
		}
	}
	return nil
}

func bytesEqual(a, b []byte) bool {
	return reflect.DeepEqual(a, b)
}

func replayStoredEvidence(prior *Ledger, evidence ReplayEvidence) (*Ledger, BlockReplay, error) {
	if prior == nil {
		return nil, BlockReplay{}, ErrReplayEvidence
	}
	if _, _, err := validateReplayEvidence(evidence, false); err != nil {
		return nil, BlockReplay{}, err
	}
	timestamp, err := evidence.Block.Time()
	if err != nil || prior.UpdatedAt > timestamp {
		return nil, BlockReplay{}, ErrReplayEvidence
	}
	next := prior.clone()
	actions := 0
	for _, transaction := range evidence.Traces {
		count, applyErr := next.ApplyTrace(timestamp, evidence.Config.Binding, transaction.Trace)
		if applyErr != nil || len(next.Accounts) > evidence.Config.MaxAccounts {
			return nil, BlockReplay{}, ErrReplayEvidence
		}
		actions += count
	}
	digest, err := replayEvidenceDigest(evidence.Parent, evidence.Block, evidence.Config, evidence.Observation.RootProof.ReceiptSetHash, prior, evidence.Transactions.Transactions, evidence.Traces)
	if err != nil {
		return nil, BlockReplay{}, err
	}
	return next, BlockReplay{Block: evidence.Block, Transactions: len(evidence.Transactions.Transactions), Actions: actions, EvidenceDigest: digest}, nil
}
