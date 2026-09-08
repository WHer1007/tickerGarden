package chainrpc

import (
	"encoding/json"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/trie"
	"math/big"
	"strings"
	"testing"
)

func TestDepositBlockBinding(t *testing.T) {
	raw := depositJSON(t, "123456789012345678901234567890")
	_, encoded, e := decodeNitroDeposit(raw, 46630)
	if e != nil {
		t.Fatal(e)
	}
	h := types.Header{Difficulty: big.NewInt(0), Number: big.NewInt(9), Time: 100, TxHash: types.DeriveSha(encodedTransactions{encoded}, trie.NewStackTrie(nil))}
	var block, tx map[string]any
	json.Unmarshal(mustJSON(h), &block)
	json.Unmarshal(raw, &tx)
	hash := h.Hash().Hex()
	block["hash"] = hash
	tx["blockHash"] = hash
	tx["blockNumber"] = "0x9"
	tx["transactionIndex"] = "0x0"
	block["transactions"] = []any{tx}
	if got, e := VerifyTransactionBlock(mustJSON(block), 46630, hash); e != nil || len(got.Transactions) != 1 || got.Transactions[0].Authentication != "nitro-deposit" {
		t.Fatalf("%+v %v", got, e)
	}
	for field, bad := range map[string]any{"from": common.Address{}.Hex(), "to": common.Address{}.Hex(), "requestId": common.Hash{}.Hex(), "value": "0x1", "blockHash": common.Hash{}.Hex(), "blockNumber": "0x8", "transactionIndex": "0x1", "gas": "0x1", "nonce": "0x1", "input": "0x01", "v": "0x1", "maxFeePerGas": "0x1", "value-overflow": "0x1"} {
		t.Run(field, func(t *testing.T) {
			var altered map[string]any
			json.Unmarshal(mustJSON(tx), &altered)
			if field == "value-overflow" {
				altered["value"] = "0x1" + strings.Repeat("0", 64)
			} else {
				altered[field] = bad
			}
			block["transactions"] = []any{altered}
			if _, e := VerifyTransactionBlock(mustJSON(block), 46630, hash); e == nil {
				t.Fatal("accepted altered deposit")
			}
		})
	}
	// A different valid deposit with a self-consistent hash still cannot replace
	// the transaction committed by the trusted block header.
	var replacement map[string]any
	json.Unmarshal(depositJSON(t, "7"), &replacement)
	replacement["blockHash"] = hash
	replacement["blockNumber"] = "0x9"
	replacement["transactionIndex"] = "0x0"
	block["transactions"] = []any{replacement}
	if _, e := VerifyTransactionBlock(mustJSON(block), 46630, hash); e == nil {
		t.Fatal("accepted replacement root")
	}
}

func TestDepositZeroTargetIsNotCreation(t *testing.T) {
	// Replace the recipient bytes in independently encoded test payload, then
	// recompute its transaction hash; zero address is a recipient, never CREATE.
	raw := depositJSON(t, "9")
	_, enc, e := decodeNitroDeposit(raw, 46630)
	if e != nil {
		t.Fatal(e)
	}
	var tx map[string]any
	json.Unmarshal(raw, &tx)
	to := common.HexToAddress(tx["to"].(string))
	zero := common.Address{}
	for i := 1; i+20 <= len(enc); i++ {
		match := true
		for j := 0; j < 20; j++ {
			if enc[i+j] != to[j] {
				match = false
				break
			}
		}
		if match {
			copy(enc[i:i+20], zero[:])
			break
		}
	}
	tx["to"] = zero.Hex()
	tx["hash"] = crypto.Keccak256Hash(enc).Hex()
	got, _, e := decodeNitroDeposit(mustJSON(tx), 46630)
	if e != nil || got.Creation || got.To != zero.Hex() {
		t.Fatalf("%+v %v", got, e)
	}
	if _, _, e := decodeNitroDeposit(raw, 1); e == nil {
		t.Fatal("wrong chain")
	}
}
