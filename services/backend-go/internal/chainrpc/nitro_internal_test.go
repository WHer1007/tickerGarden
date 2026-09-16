package chainrpc

import (
	"encoding/hex"
	"encoding/json"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rlp"
	"math/big"
	"strings"
	"testing"
)

func nitroJSON(t *testing.T, input string) []byte {
	t.Helper()
	chain := uint64(46630)
	data, e := hex.DecodeString(strings.TrimPrefix(input, "0x"))
	if e != nil {
		t.Fatal(e)
	}
	p, _ := rlp.EncodeToBytes(struct {
		ChainID *big.Int
		Data    []byte
	}{new(big.Int).SetUint64(chain), data})
	h := crypto.Keccak256Hash(append([]byte{0x6a}, p...)).Hex()
	m := map[string]any{"type": "0x6a", "chainId": "0xb626", "input": input, "hash": h, "from": arbOSAddress, "to": arbOSAddress, "nonce": "0x0", "gas": "0x0", "value": "0x0", "blockNumber": "0x9", "transactionIndex": "0x0"}
	return mustJSON(m)
}
func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
func TestNitroInternalCanonicalRLP(t *testing.T) {
	raw := nitroJSON(t, "0x")
	got, enc, e := decodeNitroInternal(raw, 46630)
	if e != nil || got.Authentication != "nitro-internal" || len(enc) == 0 {
		t.Fatalf("%+v %v", got, e)
	}
}
func TestNitroInternalRejectsMetadataAndHash(t *testing.T) {
	for name, mut := range map[string]func(map[string]any){"from": func(m map[string]any) { m["from"] = "0x" + strings.Repeat("1", 40) }, "input": func(m map[string]any) { m["input"] = "0x01" }, "hash": func(m map[string]any) { m["hash"] = "0x" + strings.Repeat("f", 64) }, "type": func(m map[string]any) { m["type"] = "0x65" }} {
		t.Run(name, func(t *testing.T) {
			var m map[string]any
			json.Unmarshal(nitroJSON(t, "0x"), &m)
			mut(m)
			if _, _, e := decodeNitroInternal(mustJSON(m), 46630); e == nil {
				t.Fatal("accepted mutation")
			}
		})
	}
}
func TestNitroInternalWrongChain(t *testing.T) {
	if _, _, e := decodeNitroInternal(nitroJSON(t, "0x"), 1); e == nil {
		t.Fatal("accepted wrong chain")
	}
}
