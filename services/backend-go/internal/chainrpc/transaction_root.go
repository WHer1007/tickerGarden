package chainrpc

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/trie"
)

var ErrTransactionBlock = errors.New("transaction block authentication unavailable")

type AuthenticatedTransaction struct {
	Hash, From, To, Input, Value string
	Type                         uint8
	Creation                     bool
	Authentication               string
}
type encodedTransactions [][]byte

func (t encodedTransactions) Len() int                           { return len(t) }
func (t encodedTransactions) EncodeIndex(i int, w *bytes.Buffer) { w.Write(t[i]) }

type TransactionBlock struct {
	Header       Header
	ReceiptRoot  string
	Transactions []AuthenticatedTransaction
	RawBlock     json.RawMessage
}

// VerifyTransactionBlock verifies full header hashing, transaction trie and
// signatures. The expected block hash/chain must come from a trusted anchor.
// This is NOT consensus verification. Unsupported Nitro types and
// unprotected legacy transactions fail closed; they are never silently omitted.
func VerifyTransactionBlock(raw []byte, chainID uint64, expectedHash string) (TransactionBlock, error) {
	fail := func() (TransactionBlock, error) { return TransactionBlock{}, ErrTransactionBlock }
	if chainID == 0 || !hashPattern.MatchString(expectedHash) || len(raw) > 32<<20 {
		return fail()
	}
	expectedHash = strings.ToLower(expectedHash)
	var h types.Header
	var envelope struct {
		Hash         string            `json:"hash"`
		Transactions []json.RawMessage `json:"transactions"`
	}
	if json.Unmarshal(raw, &h) != nil || json.Unmarshal(raw, &envelope) != nil || h.Number == nil || !h.Number.IsUint64() || h.Hash().Hex() != expectedHash || !strings.EqualFold(envelope.Hash, expectedHash) || envelope.Transactions == nil || len(envelope.Transactions) > 16384 {
		return fail()
	}
	out := TransactionBlock{Header: Header{Number: fmt.Sprintf("0x%x", h.Number), Hash: expectedHash, ParentHash: h.ParentHash.Hex(), Timestamp: fmt.Sprintf("0x%x", h.Time)}, ReceiptRoot: h.ReceiptHash.Hex(), Transactions: []AuthenticatedTransaction{}}
	transactions := make(encodedTransactions, 0, len(envelope.Transactions))
	seen := map[string]bool{}
	signer := types.LatestSignerForChainID(new(big.Int).SetUint64(chainID))
	for i, b := range envelope.Transactions {
		var kind struct{ Type string }
		if json.Unmarshal(b, &kind) != nil {
			return fail()
		}
		if kind.Type == "0x6a" || kind.Type == "0x64" {
			decoder := decodeNitroInternal
			if kind.Type == "0x64" {
				decoder = decodeNitroDeposit
			}
			custom, encoded, e := decoder(b, chainID)
			if e != nil {
				return fail()
			}
			var meta struct{ BlockHash, BlockNumber, TransactionIndex *string }
			if json.Unmarshal(b, &meta) != nil || meta.BlockHash == nil || meta.BlockNumber == nil || meta.TransactionIndex == nil || !strings.EqualFold(*meta.BlockHash, expectedHash) || *meta.BlockNumber != out.Header.Number || *meta.TransactionIndex != fmt.Sprintf("0x%x", i) || seen[custom.Hash] {
				return fail()
			}
			seen[custom.Hash] = true
			out.Transactions = append(out.Transactions, custom)
			transactions = append(transactions, encoded)
			continue
		}
		var tx types.Transaction
		var meta struct {
			Hash, From       string
			BlockHash        *string
			BlockNumber      *string
			TransactionIndex *string
		}
		if json.Unmarshal(b, &tx) != nil || json.Unmarshal(b, &meta) != nil || !tx.Protected() || tx.ChainId().Cmp(new(big.Int).SetUint64(chainID)) != 0 || !addressPattern.MatchString(meta.From) || !hashPattern.MatchString(meta.Hash) || meta.BlockHash == nil || meta.BlockNumber == nil || meta.TransactionIndex == nil || !strings.EqualFold(*meta.BlockHash, expectedHash) || *meta.BlockNumber != out.Header.Number || *meta.TransactionIndex != fmt.Sprintf("0x%x", i) {
			return fail()
		}
		hash := tx.Hash().Hex()
		if !strings.EqualFold(meta.Hash, hash) || seen[hash] {
			return fail()
		}
		seen[hash] = true
		from, e := types.Sender(signer, &tx)
		if e != nil || !strings.EqualFold(from.Hex(), meta.From) {
			return fail()
		}
		to := crypto.CreateAddress(from, tx.Nonce())
		if tx.To() != nil {
			to = *tx.To()
		}
		out.Transactions = append(out.Transactions, AuthenticatedTransaction{Hash: hash, From: strings.ToLower(from.Hex()), To: strings.ToLower(to.Hex()), Input: "0x" + hex.EncodeToString(tx.Data()), Value: "0x" + tx.Value().Text(16), Type: tx.Type(), Creation: tx.To() == nil, Authentication: "signature"})
		encoded, e := tx.MarshalBinary()
		if e != nil {
			return fail()
		}
		transactions = append(transactions, encoded)
	}
	if types.DeriveSha(transactions, trie.NewStackTrie(nil)) != h.TxHash {
		return fail()
	}
	out.RawBlock = append(json.RawMessage(nil), raw...)
	return out, nil
}

// AuthenticatedTransactions reads the entire block; a canonical fence after
// verification prevents mixed-branch input. Caller still owns finality/genesis.
func (c *Client) AuthenticatedTransactions(ctx context.Context, chainID uint64, hash string) (TransactionBlock, error) {
	if !hashPattern.MatchString(hash) || chainID == 0 {
		return TransactionBlock{}, ErrTransactionBlock
	}
	id, e := c.ChainID(ctx)
	if e != nil || id != chainID {
		return TransactionBlock{}, ErrTransactionBlock
	}
	var raw json.RawMessage
	if c.call(ctx, "eth_getBlockByHash", []any{hash, true}, &raw) != nil {
		return TransactionBlock{}, ErrTransactionBlock
	}
	out, e := VerifyTransactionBlock(raw, chainID, hash)
	if e != nil {
		return TransactionBlock{}, e
	}
	h, e := c.Header(ctx, out.Header.Number)
	if e != nil || h != out.Header {
		return TransactionBlock{}, ErrTransactionBlock
	}
	return out, nil
}
