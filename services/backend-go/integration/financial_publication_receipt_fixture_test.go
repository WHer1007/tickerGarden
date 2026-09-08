package integration

import (
	"bytes"
	"encoding/json"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/trie"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/projection"
)

type financialReceiptFixture struct {
	Header      chainrpc.Header
	Receipt     chainrpc.Receipt
	Logs        []chainrpc.Log
	ReceiptRoot string
	RawHeader   json.RawMessage
	RawReceipt  json.RawMessage
}
type encodedFinancialReceipts [][]byte

func (r encodedFinancialReceipts) Len() int                           { return len(r) }
func (r encodedFinancialReceipts) EncodeIndex(i int, w *bytes.Buffer) { w.Write(r[i]) }

// makeFinancialPublicationReceiptFixture builds a single-transaction receipt
// and header committing to its exact consensus RLP.
func makeFinancialPublicationReceiptFixture(chainID, number uint64, parentHash, txHash string, inputs []projection.Input) (financialReceiptFixture, error) {
	_ = chainID // retained in the helper contract for callers constructing chain-scoped fixtures.
	tx, parent := common.HexToHash(txHash), common.HexToHash(parentHash)
	logs := make([]chainrpc.Log, 0, len(inputs))
	for _, in := range inputs {
		logs = append(logs, in.Log)
	}
	sort.SliceStable(logs, func(i, j int) bool {
		a, _ := chainrpc.Quantity(logs[i].LogIndex)
		b, _ := chainrpc.Quantity(logs[j].LogIndex)
		return a < b
	})
	for i := range logs {
		logs[i].TransactionHash = tx.Hex()
		logs[i].TransactionIndex = "0x0"
		logs[i].LogIndex = "0x" + strconv.FormatUint(uint64(i), 16)
		logs[i].Removed = false
	}
	gethLogs := make([]*types.Log, 0, len(logs))
	for _, l := range logs {
		gl := &types.Log{Address: common.HexToAddress(l.Address), Data: common.FromHex(l.Data), Index: uint(parseFixtureQuantity(l.LogIndex))}
		for _, topic := range l.Topics {
			gl.Topics = append(gl.Topics, common.HexToHash(topic))
		}
		gethLogs = append(gethLogs, gl)
	}
	n := new(big.Int).SetUint64(number)
	receipt := &types.Receipt{Type: 2, Status: types.ReceiptStatusSuccessful, CumulativeGasUsed: 21000, GasUsed: 21000, TxHash: tx, BlockNumber: n, Logs: gethLogs}
	receipt.Bloom = types.CreateBloom(receipt)
	encoded, err := receipt.MarshalBinary()
	if err != nil {
		return financialReceiptFixture{}, err
	}
	root := types.DeriveSha(encodedFinancialReceipts{encoded}, trie.NewStackTrie(nil))
	header := types.Header{Difficulty: big.NewInt(0), ParentHash: parent, Number: n, GasLimit: 30_000_000, GasUsed: 21000, Time: 1, TxHash: common.HexToHash(txHash), ReceiptHash: root, UncleHash: types.EmptyUncleHash}
	blockHash := header.Hash()
	receipt.BlockHash = blockHash
	for i := range logs {
		logs[i].BlockHash = blockHash.Hex()
		logs[i].BlockNumber = "0x" + strconv.FormatUint(number, 16)
	}
	rawReceipt, err := json.Marshal(receipt)
	if err != nil {
		return financialReceiptFixture{}, err
	}
	var rm map[string]any
	if err := json.Unmarshal(rawReceipt, &rm); err != nil {
		return financialReceiptFixture{}, err
	}
	rm["transactionHash"] = tx.Hex()
	rm["transactionIndex"] = "0x0"
	rm["blockHash"] = blockHash.Hex()
	rm["blockNumber"] = "0x" + strconv.FormatUint(number, 16)
	rm["status"] = "0x1"
	rm["logs"] = logs
	rawReceipt, err = json.Marshal(rm)
	if err != nil {
		return financialReceiptFixture{}, err
	}
	headerJSON, err := json.Marshal(&header)
	if err != nil {
		return financialReceiptFixture{}, err
	}
	var hm map[string]any
	if err := json.Unmarshal(headerJSON, &hm); err != nil {
		return financialReceiptFixture{}, err
	}
	hm["hash"], hm["transactions"] = blockHash.Hex(), []string{tx.Hex()}
	rawHeader, err := json.Marshal(hm)
	if err != nil {
		return financialReceiptFixture{}, err
	}
	minimal := chainrpc.Receipt{TransactionHash: tx.Hex(), TransactionIndex: "0x0", BlockHash: blockHash.Hex(), BlockNumber: "0x" + strconv.FormatUint(number, 16), Status: "0x1", Logs: logs}
	return financialReceiptFixture{Header: chainrpc.Header{Timestamp: "0x1", Number: "0x" + strconv.FormatUint(number, 16), Hash: blockHash.Hex(), ParentHash: parent.Hex()}, Receipt: minimal, Logs: logs, ReceiptRoot: root.Hex(), RawHeader: rawHeader, RawReceipt: rawReceipt}, nil
}
func parseFixtureQuantity(s string) uint64 { n, _ := chainrpc.Quantity(s); return n }

func TestFinancialPublicationReceiptFixtureConsensusRootAndJSON(t *testing.T) {
	addr := "0x" + strings.Repeat("11", 20)
	in := projection.Input{ChainID: 1, Module: "TickerMemeTokenV1", Log: chainrpc.Log{Address: addr, Topics: []string{common.HexToHash("0x1").Hex()}, Data: "0x1234", LogIndex: "0x7"}}
	f, err := makeFinancialPublicationReceiptFixture(1, 9, common.HexToHash("0x2").Hex(), common.HexToHash("0x3").Hex(), []projection.Input{in})
	if err != nil {
		t.Fatal(err)
	}
	var h map[string]any
	if err := json.Unmarshal(f.RawHeader, &h); err != nil {
		t.Fatal(err)
	}
	if h["hash"] != f.Header.Hash || h["parentHash"] != f.Header.ParentHash || h["number"] != f.Header.Number || h["receiptsRoot"] != f.ReceiptRoot {
		t.Fatalf("header mismatch: %#v", h)
	}
	var r chainrpc.Receipt
	if err := json.Unmarshal(f.RawReceipt, &r); err != nil {
		t.Fatal(err)
	}
	if r.TransactionHash != f.Receipt.TransactionHash || r.BlockNumber != f.Header.Number || r.BlockHash != f.Header.Hash || r.Status != "0x1" {
		t.Fatalf("receipt mismatch: %#v", r)
	}
	if len(r.Logs) != 1 || r.Logs[0].TransactionHash != r.TransactionHash || r.Logs[0].BlockHash != f.Header.Hash || r.Logs[0].BlockNumber != f.Header.Number || r.Logs[0].LogIndex != "0x0" {
		t.Fatalf("log mismatch: %#v", r.Logs)
	}
	var consensusReceipt types.Receipt
	if err := json.Unmarshal(f.RawReceipt, &consensusReceipt); err != nil {
		t.Fatalf("consensus receipt JSON invalid: %v: %s", err, f.RawReceipt)
	}
	if types.CreateBloom(&consensusReceipt) != consensusReceipt.Bloom {
		t.Fatalf("receipt bloom mismatch: %s", f.RawReceipt)
	}
	proof, err := chainrpc.VerifyReceiptRootBundle(f.RawHeader, []json.RawMessage{f.RawReceipt}, f.Header.Hash)
	if err != nil || proof.ReceiptRoot != f.ReceiptRoot || proof.ReceiptCount != 1 {
		t.Fatalf("receipt-root bundle rejected: proof=%+v err=%v", proof, err)
	}
}
