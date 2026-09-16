package chainrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/trie"
)

type ReceiptRootVerification struct {
	BlockHash      string             `json:"blockHash"`
	ReceiptRoot    string             `json:"receiptRoot"`
	ReceiptCount   int                `json:"receiptCount"`
	ReceiptSetHash string             `json:"receiptSetHash"`
	Bundle         *ReceiptRootBundle `json:"bundle,omitempty"`
}

type ReceiptRootBundle struct {
	Header   json.RawMessage   `json:"header"`
	Receipts []json.RawMessage `json:"receipts"`
}

type encodedReceiptList [][]byte

func (r encodedReceiptList) Len() int                           { return len(r) }
func (r encodedReceiptList) EncodeIndex(i int, w *bytes.Buffer) { w.Write(r[i]) }

// VerifyReceiptRoot binds consensus receipt encodings to the hash of the full
// header. It does not authenticate the header through consensus or another node,
// nor prove transaction-hash metadata via the transaction trie. Nitro pre-upgrade
// legacy 0x78 receipts are intentionally unsupported and fail closed.
func (c *Client) VerifyReceiptRoot(ctx context.Context, hash string) (ReceiptRootVerification, error) {
	bad := errors.New("receipt root verification unavailable or mismatched")
	fail := func() (ReceiptRootVerification, error) { return ReceiptRootVerification{}, bad }
	if !hashPattern.MatchString(hash) {
		return fail()
	}
	var raw json.RawMessage
	if err := c.call(ctx, "eth_getBlockByHash", []any{hash, false}, &raw); err != nil {
		return fail()
	}
	var block struct {
		Number       string   `json:"number"`
		Transactions []string `json:"transactions"`
	}
	if json.Unmarshal(raw, &block) != nil || block.Transactions == nil || len(block.Transactions) > 16384 {
		return fail()
	}
	rawReceipts, err := c.receiptRootInputs(ctx, block.Transactions)
	if err != nil {
		return fail()
	}
	proof, err := VerifyReceiptRootBundle(raw, rawReceipts, hash)
	if err != nil {
		return fail()
	}
	number := block.Number
	var current Header
	if err := c.call(ctx, "eth_getBlockByNumber", []any{number, false}, &current); err != nil || current.Hash != hash || current.Number != number {
		return fail()
	}
	return proof, nil
}

// VerifyReceiptRootBundle revalidates a retained header and the exact ordered
// receipt JSON without RPC access. The expected hash still needs a trusted
// canonical/finality anchor supplied by the caller.
func VerifyReceiptRootBundle(raw json.RawMessage, rawReceipts []json.RawMessage, hash string) (ReceiptRootVerification, error) {
	bad := errors.New("receipt root verification unavailable or mismatched")
	fail := func() (ReceiptRootVerification, error) { return ReceiptRootVerification{}, bad }
	if !hashPattern.MatchString(hash) || len(raw) == 0 || len(raw) > 32<<20 || rawReceipts == nil || len(rawReceipts) > 16384 {
		return fail()
	}
	var header types.Header
	var block struct {
		Hash         string   `json:"hash"`
		Number       string   `json:"number"`
		Transactions []string `json:"transactions"`
	}
	if json.Unmarshal(raw, &header) != nil || json.Unmarshal(raw, &block) != nil || header.Number == nil || header.Hash().Hex() != hash || block.Hash != hash || block.Transactions == nil || len(block.Transactions) != len(rawReceipts) {
		return fail()
	}
	number := fmt.Sprintf("0x%x", header.Number)
	if block.Number != number {
		return fail()
	}
	encoded := make(encodedReceiptList, 0, len(block.Transactions))
	receipts := make([]Receipt, 0, len(block.Transactions))
	seen := map[string]bool{}
	for _, txHash := range block.Transactions {
		if !hashPattern.MatchString(txHash) || seen[txHash] {
			return fail()
		}
		seen[txHash] = true
	}
	total := 0
	var cumulative uint64
	for i, txHash := range block.Transactions {
		data := rawReceipts[i]
		if len(data) == 0 || len(data) > (64<<20)-total {
			return fail()
		}
		total += len(data)
		var r types.Receipt
		var minimal Receipt
		var typ struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(data, &r) != nil || json.Unmarshal(data, &minimal) != nil || json.Unmarshal(data, &typ) != nil || ValidateTransactionReceipt(txHash, &minimal) != nil || minimal.BlockHash != hash || minimal.BlockNumber != number || minimal.TransactionIndex != fmt.Sprintf("0x%x", i) {
			return fail()
		}
		var t uint64
		var err error
		if typ.Type != "" {
			t, err = Quantity(typ.Type)
		}
		if err != nil || t > 255 || uint64(r.Type) != t {
			return fail()
		}
		switch t {
		case 0, 1, 2, 3, 4, 0x64, 0x65, 0x66, 0x68, 0x69, 0x6a:
		default:
			return fail()
		}
		if len(r.PostState) != 0 || r.CumulativeGasUsed < cumulative || types.CreateBloom(&r) != r.Bloom {
			return fail()
		}
		cumulative = r.CumulativeGasUsed
		value, err := r.MarshalBinary()
		if err != nil {
			return fail()
		}
		encoded = append(encoded, value)
		receipts = append(receipts, minimal)
	}
	if cumulative != header.GasUsed || types.DeriveSha(encoded, trie.NewStackTrie(nil)) != header.ReceiptHash {
		return fail()
	}
	commitment, err := ReceiptSetCommitment(receipts)
	if err != nil {
		return fail()
	}
	bundleReceipts := make([]json.RawMessage, len(rawReceipts))
	for i := range rawReceipts {
		bundleReceipts[i] = append(json.RawMessage(nil), rawReceipts[i]...)
	}
	return ReceiptRootVerification{BlockHash: hash, ReceiptRoot: header.ReceiptHash.Hex(), ReceiptCount: len(encoded), ReceiptSetHash: commitment, Bundle: &ReceiptRootBundle{Header: append(json.RawMessage(nil), raw...), Receipts: bundleReceipts}}, nil
}
