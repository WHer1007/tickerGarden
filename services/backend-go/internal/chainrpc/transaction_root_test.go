package chainrpc

import (
	"encoding/json"
	"fmt"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/trie"
	"math/big"
	"strings"
	"testing"
)

func txFixture(t *testing.T) ([]byte, string) { return txFixtureCount(t, 1) }
func txFixtureCount(t *testing.T, count int) ([]byte, string) {
	t.Helper()
	key, e := crypto.GenerateKey()
	if e != nil {
		t.Fatal(e)
	}
	chain := big.NewInt(46630)
	signer := types.LatestSignerForChainID(chain)
	to := crypto.PubkeyToAddress(key.PublicKey)
	txs := types.Transactions{}
	for i := 0; i < count; i++ {
		tx, e := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: chain, Nonce: uint64(i), GasTipCap: big.NewInt(1), GasFeeCap: big.NewInt(2), Gas: 21000, To: &to, Value: big.NewInt(7), Data: []byte{1, 2}}), signer, key)
		if e != nil {
			t.Fatal(e)
		}
		txs = append(txs, tx)
	}
	h := types.Header{Difficulty: big.NewInt(0), ParentHash: crypto.Keccak256Hash([]byte("p")), Number: big.NewInt(9), Time: 100, TxHash: types.DeriveSha(txs, trie.NewStackTrie(nil))}
	hb, e := json.Marshal(h)
	if e != nil {
		t.Fatal(e)
	}
	var hm map[string]any
	if json.Unmarshal(hb, &hm) != nil {
		t.Fatal("header")
	}
	bh := h.Hash().Hex()
	hm["hash"] = bh
	list := []any{}
	for i, tx := range txs {
		tb, e := tx.MarshalJSON()
		if e != nil {
			t.Fatal(e)
		}
		var tm map[string]any
		if json.Unmarshal(tb, &tm) != nil {
			t.Fatal("tx")
		}
		tm["hash"] = tx.Hash().Hex()
		tm["from"] = to.Hex()
		tm["blockHash"] = bh
		tm["blockNumber"] = "0x9"
		tm["transactionIndex"] = fmt.Sprintf("0x%x", i)
		list = append(list, tm)
	}
	hm["transactions"] = list
	raw, e := json.Marshal(hm)
	if e != nil {
		t.Fatal(e)
	}
	return raw, bh
}
func TestVerifyTransactionBlockSignedDynamic(t *testing.T) {
	raw, h := txFixture(t)
	got, e := VerifyTransactionBlock(raw, 46630, h)
	if e != nil || len(got.Transactions) != 1 || got.Transactions[0].Value != "0x7" || !json.Valid(got.RawBlock) {
		t.Fatalf("%+v %v", got, e)
	}
}
func TestVerifyTransactionBlockRejectsIdentityAndRoot(t *testing.T) {
	raw, h := txFixture(t)
	var m map[string]any
	json.Unmarshal(raw, &m)
	txs := m["transactions"].([]any)
	txs[0].(map[string]any)["from"] = "0x0000000000000000000000000000000000000001"
	raw, _ = json.Marshal(m)
	if _, e := VerifyTransactionBlock(raw, 46630, h); e == nil {
		t.Fatal("forged sender accepted")
	}
	raw, h = txFixture(t)
	m = map[string]any{}
	json.Unmarshal(raw, &m)
	m["transactions"] = []any{}
	raw, _ = json.Marshal(m)
	if _, e := VerifyTransactionBlock(raw, 46630, h); e == nil {
		t.Fatal("changed tx root accepted")
	}
}
func TestVerifyTransactionBlockRejectsWrongChainAndHash(t *testing.T) {
	raw, h := txFixture(t)
	if _, e := VerifyTransactionBlock(raw, 1, h); e == nil {
		t.Fatal("wrong chain accepted")
	}
	if _, e := VerifyTransactionBlock(raw, 46630, "0x"+strings.Repeat("f", 64)); e == nil {
		t.Fatal("wrong hash accepted")
	}
}
func TestVerifyTransactionBlockEmptyAndMutations(t *testing.T) {
	raw, h := txFixture(t)
	var m map[string]any
	json.Unmarshal(raw, &m)
	m["transactions"] = []any{}
	var hdr types.Header
	b, _ := json.Marshal(m)
	json.Unmarshal(b, &hdr)
	hdr.TxHash = types.DeriveSha(types.Transactions{}, trie.NewStackTrie(nil))
	hb, _ := json.Marshal(hdr)
	var hm map[string]any
	json.Unmarshal(hb, &hm)
	nh := hdr.Hash().Hex()
	hm["hash"] = nh
	hm["transactions"] = []any{}
	b, _ = json.Marshal(hm)
	if got, e := VerifyTransactionBlock(b, 46630, nh); e != nil || len(got.Transactions) != 0 {
		t.Fatalf("empty %v", e)
	}
	raw, h = txFixture(t)
	json.Unmarshal(raw, &m)
	m["transactions"].([]any)[0].(map[string]any)["hash"] = "0x" + strings.Repeat("a", 64)
	b, _ = json.Marshal(m)
	if _, e := VerifyTransactionBlock(b, 46630, h); e == nil {
		t.Fatal("forged tx hash accepted")
	}
	raw, h = txFixture(t)
	json.Unmarshal(raw, &m)
	m["transactions"].([]any)[0].(map[string]any)["type"] = "0x64"
	b, _ = json.Marshal(m)
	if _, e := VerifyTransactionBlock(b, 46630, h); e == nil {
		t.Fatal("unsupported type accepted")
	}
}

func TestVerifyTransactionBlockRejectsReorderedTrie(t *testing.T) {
	raw, h := txFixtureCount(t, 2)
	if _, e := VerifyTransactionBlock(raw, 46630, h); e != nil {
		t.Fatal("baseline", e)
	}
	var m map[string]any
	json.Unmarshal(raw, &m)
	txs := m["transactions"].([]any)
	txs[0], txs[1] = txs[1], txs[0]
	// Keep metadata self-consistent; only authenticated trie order should fail.
	for i, v := range txs {
		v.(map[string]any)["transactionIndex"] = fmt.Sprintf("0x%x", i)
	}
	raw, _ = json.Marshal(m)
	if _, e := VerifyTransactionBlock(raw, 46630, h); e == nil {
		t.Fatal("reordered tx trie accepted")
	}
}
