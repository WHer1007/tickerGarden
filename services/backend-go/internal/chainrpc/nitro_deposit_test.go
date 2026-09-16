package chainrpc

import (
	"encoding/json"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rlp"
	"math/big"
	"strings"
	"testing"
)

func depositJSON(t *testing.T, value string) []byte {
	t.Helper()
	n, _ := new(big.Int).SetString(value, 10)
	chain := uint64(46630)
	from := "0x" + strings.Repeat("1", 40)
	to := "0x" + strings.Repeat("2", 40)
	req := crypto.Keccak256Hash([]byte("request"))
	enc, _ := rlp.EncodeToBytes(struct {
		ChainID     *big.Int
		L1RequestId [32]byte
		From, To    common.Address
		Value       *big.Int
	}{new(big.Int).SetUint64(chain), req, common.HexToAddress(from), common.HexToAddress(to), n})
	h := crypto.Keccak256Hash(append([]byte{0x64}, enc...)).Hex()
	return mustJSON(map[string]any{"type": "0x64", "chainId": "0xb626", "requestId": req.Hex(), "from": from, "to": to, "value": "0x" + n.Text(16), "input": "0x", "nonce": "0x0", "gas": "0x0", "hash": h})
}
func TestNitroDepositCanonicalRLP(t *testing.T) {
	raw := depositJSON(t, "123456789012345678901234567890")
	got, enc, e := decodeNitroDeposit(raw, 46630)
	if e != nil || len(enc) == 0 || got.Type != 0x64 || got.Creation || got.Value == "0x0" {
		t.Fatalf("%+v %v", got, e)
	}
}
func TestNitroDepositRejectsMutations(t *testing.T) {
	for name := range map[string]bool{"requestId": true, "from": true, "to": true, "value": true, "chainId": true, "input": true, "nonce": true, "gas": true, "hash": true} {
		t.Run(name, func(t *testing.T) {
			var m map[string]any
			json.Unmarshal(depositJSON(t, "9"), &m)
			delete(m, name)
			if _, _, e := decodeNitroDeposit(mustJSON(m), 46630); e == nil {
				t.Fatal("accepted missing field")
			}
		})
	}
}
