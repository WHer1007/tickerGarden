package holderledger

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/trie"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

func TestReplayEvidenceRoundTripAndOfflineReplay(t *testing.T) {
	ledger, rpc, config := replayCase(t)
	prior := ledger.clone()
	capture := &replayCaptureRPC{BlockReplayRPC: rpc}
	report, err := ledger.ReplayNextBlock(t.Context(), capture, config, rpc.parent, rpc.block)
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := capture.evidence(rpc.parent, rpc.block, config)
	if err != nil {
		t.Fatal(err)
	}
	raw, digest, err := validateReplayEvidence(evidence, false)
	if err != nil || len(raw) == 0 || !replayDigestPattern.MatchString(digest) {
		t.Fatal(digest, err)
	}
	if _, _, err = validateReplayEvidence(evidence, true); !errors.Is(err, ErrReplayEvidence) {
		t.Fatal("parsed-only fixture passed raw-root gate", err)
	}
	replayed, offline, err := replayStoredEvidence(prior, evidence)
	if err != nil || offline != report {
		t.Fatal(offline, report, err)
	}
	want, _ := EncodeCheckpoint(ledger)
	got, _ := EncodeCheckpoint(replayed)
	if !bytes.Equal(want, got) {
		t.Fatal("offline replay diverged")
	}
	var decoded ReplayEvidence
	if json.Unmarshal(raw, &decoded) != nil {
		t.Fatal("stored evidence does not decode")
	}
}

func TestReplayEvidenceReverifiesRawRoots(t *testing.T) {
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	chainID := big.NewInt(1)
	signer := types.LatestSignerForChainID(chainID)
	to := common.HexToAddress(distributor)
	input, err := hexDecode(checkpointInput())
	if err != nil {
		t.Fatal(err)
	}
	tx, err := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: chainID, GasTipCap: big.NewInt(1), GasFeeCap: big.NewInt(2), Gas: 100000, To: &to, Data: input}), signer, key)
	if err != nil {
		t.Fatal(err)
	}
	receipt := types.Receipt{Type: tx.Type(), Status: 1, CumulativeGasUsed: 21000, GasUsed: 21000, TxHash: tx.Hash(), BlockNumber: big.NewInt(1), Logs: []*types.Log{}}
	receiptEncoded, err := receipt.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	header := types.Header{Difficulty: big.NewInt(0), ParentHash: crypto.Keccak256Hash([]byte("parent")), Number: big.NewInt(1), GasLimit: 30000000, GasUsed: 21000, Time: 1, TxHash: types.DeriveSha(types.Transactions{tx}, trie.NewStackTrie(nil)), ReceiptHash: types.DeriveSha(encodedReceipts{receiptEncoded}, trie.NewStackTrie(nil)), UncleHash: types.EmptyUncleHash}
	blockHash := header.Hash().Hex()
	receipt.BlockHash = header.Hash()
	txJSON, _ := tx.MarshalJSON()
	var transaction map[string]any
	if json.Unmarshal(txJSON, &transaction) != nil {
		t.Fatal("transaction JSON")
	}
	from, err := types.Sender(signer, tx)
	if err != nil {
		t.Fatal(err)
	}
	transaction["hash"] = tx.Hash().Hex()
	transaction["from"] = strings.ToLower(from.Hex())
	transaction["blockHash"] = blockHash
	transaction["blockNumber"] = "0x1"
	transaction["transactionIndex"] = "0x0"
	headerJSON, _ := json.Marshal(&header)
	var fullBlock map[string]any
	json.Unmarshal(headerJSON, &fullBlock)
	fullBlock["hash"] = blockHash
	fullBlock["transactions"] = []any{transaction}
	rawBlock, _ := json.Marshal(fullBlock)
	var receiptHeader map[string]any
	json.Unmarshal(headerJSON, &receiptHeader)
	receiptHeader["hash"] = blockHash
	receiptHeader["transactions"] = []string{tx.Hash().Hex()}
	rawReceiptHeader, _ := json.Marshal(receiptHeader)
	rawReceipt, _ := json.Marshal(&receipt)
	transactions, err := chainrpc.VerifyTransactionBlock(rawBlock, 1, blockHash)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := chainrpc.VerifyReceiptRootBundle(rawReceiptHeader, []json.RawMessage{rawReceipt}, blockHash)
	if err != nil {
		t.Fatal(err)
	}
	var minimal chainrpc.Receipt
	if json.Unmarshal(rawReceipt, &minimal) != nil {
		t.Fatal("receipt JSON")
	}
	parent := chainrpc.Header{Number: "0x0", Timestamp: "0x0", Hash: header.ParentHash.Hex(), ParentHash: "0x" + strings.Repeat("0", 64)}
	block := transactions.Header
	trace := chainrpc.CallTrace{Type: "CALL", From: transactions.Transactions[0].From, To: transactions.Transactions[0].To, Input: transactions.Transactions[0].Input, Output: "0x", Value: transactions.Transactions[0].Value}
	config := ReconcileConfig{ChainID: 1, GenesisHash: parent.Hash, Binding: traceBinding(), Quote: zero, TokenCodeHash: deployment.Hash([]byte{1}), DistributorCodeHash: deployment.Hash([]byte{1}), MaxAccounts: 10}
	evidence := ReplayEvidence{Version: 1, Parent: parent, Block: block, Config: config, Transactions: transactions, Observation: chainrpc.Observation{Logs: []chainrpc.Log{}, Receipts: []chainrpc.Receipt{minimal}, RootProof: &proof}, Traces: []TransactionTrace{{TransactionHash: tx.Hash().Hex(), Trace: trace}}}
	if _, _, err := validateReplayEvidence(evidence, true); err != nil {
		t.Fatal("raw-root evidence rejected", err)
	}
	if _, _, err := replayStoredEvidence(traceLedger(t), evidence); err != nil {
		t.Fatal("raw-root evidence did not replay", err)
	}
	evidence.Transactions.RawBlock[0] ^= 1
	if _, _, err := validateReplayEvidence(evidence, true); !errors.Is(err, ErrReplayEvidence) {
		t.Fatal("tampered raw block accepted", err)
	}
}

type encodedReceipts [][]byte

func (r encodedReceipts) Len() int                                { return len(r) }
func (r encodedReceipts) EncodeIndex(i int, buffer *bytes.Buffer) { buffer.Write(r[i]) }

func hexDecode(value string) ([]byte, error) {
	return hex.DecodeString(strings.TrimPrefix(value, "0x"))
}

func TestReplayEvidenceRejectsMutation(t *testing.T) {
	ledger, rpc, config := replayCase(t)
	capture := &replayCaptureRPC{BlockReplayRPC: rpc}
	if _, err := ledger.ReplayNextBlock(t.Context(), capture, config, rpc.parent, rpc.block); err != nil {
		t.Fatal(err)
	}
	evidence, err := capture.evidence(rpc.parent, rpc.block, config)
	if err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*ReplayEvidence){
		func(value *ReplayEvidence) { value.Traces[0].TransactionHash = value.Block.Hash },
		func(value *ReplayEvidence) { value.Observation.Receipts[0].Status = "0x0" },
		func(value *ReplayEvidence) { value.Block.ParentHash = value.Block.Hash },
		func(value *ReplayEvidence) { value.Config.ChainID = 0 },
	} {
		copy := evidence
		raw, _ := json.Marshal(evidence)
		if json.Unmarshal(raw, &copy) != nil {
			t.Fatal("copy")
		}
		mutate(&copy)
		if _, _, err := validateReplayEvidence(copy, false); !errors.Is(err, ErrReplayEvidence) {
			t.Fatal("mutated evidence accepted", err)
		}
	}
}
