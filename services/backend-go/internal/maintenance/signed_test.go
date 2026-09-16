package maintenance

import (
	"encoding/hex"
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

// Public, deterministic test-only key, never loaded from an operator key store.
func signedFixture(t *testing.T) (IntentRecord, *types.DynamicFeeTx, []byte) {
	t.Helper()
	key, e := crypto.HexToECDSA(strings.Repeat("0", 63) + "1")
	if e != nil {
		t.Fatal(e)
	}
	from := strings.ToLower(crypto.PubkeyToAddress(key.PublicKey).Hex())
	to := common.HexToAddress("0x" + strings.Repeat("2", 40))
	tx := &types.DynamicFeeTx{ChainID: big.NewInt(46630), Nonce: 0, GasTipCap: big.NewInt(2), GasFeeCap: big.NewInt(100), Gas: 50000, To: &to, Value: big.NewInt(0), Data: []byte{0x12, 0x34, 0x56, 0x78}}
	in := Intent{Reservation: Reservation{JobKey: "0x" + strings.Repeat("1", 64), ChainID: 46630, Sender: from, Nonce: "0", Status: "nonce_reserved"}, Call: chainrpc.IntentCall{From: from, To: strings.ToLower(to.Hex()), Data: "0x12345678", Value: "0x0", Gas: "0xc350", Nonce: "0x0", MaxFeePerGas: "0x64", MaxPriorityFeePerGas: "0x2"}, Type: "0x2", Status: "intent_prepared"}
	body, _ := json.Marshal(in)
	record := IntentRecord{Digest: deployment.Hash(body), Intent: in}
	signed, e := types.SignTx(types.NewTx(tx), types.NewLondonSigner(tx.ChainID), key)
	if e != nil {
		t.Fatal(e)
	}
	raw, e := signed.MarshalBinary()
	if e != nil {
		t.Fatal(e)
	}
	return record, tx, raw
}
func TestSignedTransactionMatchesIntent(t *testing.T) {
	record, _, raw := signedFixture(t)
	got, e := ValidateSigned(record, raw)
	if e != nil || got.Sender != record.Intent.Call.From || got.TransactionHash != deployment.Hash(raw) || got.RawTransaction != "0x"+hex.EncodeToString(raw) || got.IntentDigest != record.Digest {
		t.Fatal(got, e)
	}
}
func TestSignedTransactionRejectsAlteredFields(t *testing.T) {
	for _, name := range []string{"chain", "nonce", "gas", "fee", "tip", "value", "to", "data", "access-list", "creation", "sender", "high-s", "trailing", "oversize", "legacy"} {
		t.Run(name, func(t *testing.T) {
			record, tx, raw := signedFixture(t)
			switch name {
			case "chain":
				tx.ChainID = big.NewInt(1)
			case "nonce":
				tx.Nonce++
			case "gas":
				tx.Gas++
			case "fee":
				tx.GasFeeCap = big.NewInt(101)
			case "tip":
				tx.GasTipCap = big.NewInt(3)
			case "value":
				tx.Value = big.NewInt(1)
			case "to":
				a := common.HexToAddress("0x" + strings.Repeat("3", 40))
				tx.To = &a
			case "data":
				tx.Data = []byte{1}
			case "access-list":
				tx.AccessList = types.AccessList{{Address: *tx.To}}
			case "creation":
				tx.To = nil
			}
			keyText := strings.Repeat("0", 63) + "1"
			if name == "sender" {
				keyText = strings.Repeat("0", 63) + "2"
			}
			key, _ := crypto.HexToECDSA(keyText)
			signed, e := types.SignTx(types.NewTx(tx), types.NewLondonSigner(tx.ChainID), key)
			if e != nil {
				t.Fatal(e)
			}
			raw, e = signed.MarshalBinary()
			if e != nil {
				t.Fatal(e)
			}
			switch name {
			case "high-s":
				v, r, s := signed.RawSignatureValues()
				tx.V = new(big.Int).Xor(v, big.NewInt(1))
				tx.R = r
				tx.S = new(big.Int).Sub(crypto.S256().Params().N, s)
				raw, e = types.NewTx(tx).MarshalBinary()
			case "trailing":
				raw = append(raw, 0)
			case "oversize":
				raw = make([]byte, 16385)
			case "legacy":
				legacy, err := types.SignTx(types.NewTx(&types.LegacyTx{Gas: 50000, GasPrice: big.NewInt(100), To: tx.To, Value: big.NewInt(0), Data: tx.Data}), types.NewEIP155Signer(tx.ChainID), key)
				if err != nil {
					t.Fatal(err)
				}
				raw, e = legacy.MarshalBinary()
			}
			if e != nil {
				t.Fatal(e)
			}
			if _, e = ValidateSigned(record, raw); e == nil {
				t.Fatal("altered transaction accepted")
			}
		})
	}
}
