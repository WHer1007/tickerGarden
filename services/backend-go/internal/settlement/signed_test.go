package settlement

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
)

func signedFixture(t *testing.T) (IntentRecord, []byte) {
	t.Helper()
	key, err := crypto.HexToECDSA(strings.Repeat("11", 32))
	if err != nil {
		t.Fatal(err)
	}
	from := crypto.PubkeyToAddress(key.PublicKey).Hex()
	to := common.HexToAddress("0x2222222222222222222222222222222222222222")
	data := []byte{1, 2, 3}
	intent := TransactionIntent{JobKey: "job", ChainID: 4663, GenesisHash: "0x" + strings.Repeat("a", 64), Nonce: "7", Call: typesCall(from, to, data), Fees: ExecutionPolicy{GasLimit: "21000", MaxFeePerGas: "2", MaxPriorityFeePerGas: "1", MaximumGasCost: "42000"}, MaximumGasCost: "42000", Type: "0x2", Status: "intent_prepared"}
	body, _ := json.Marshal(intent)
	sum := sha256.Sum256(body)
	tx := types.NewTx(&types.DynamicFeeTx{ChainID: big.NewInt(4663), Nonce: 7, Gas: 21000, GasFeeCap: big.NewInt(2), GasTipCap: big.NewInt(1), To: &to, Data: data})
	tx, err = types.SignTx(tx, types.NewLondonSigner(big.NewInt(4663)), key)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := tx.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	return IntentRecord{Digest: hex.EncodeToString(sum[:]), Intent: intent}, raw
}

func typesCall(from string, to common.Address, data []byte) chainrpc.IntentCall {
	return chainrpc.IntentCall{From: strings.ToLower(from), To: strings.ToLower(to.Hex()), Data: "0x" + hex.EncodeToString(data), Value: "0x0", Gas: "0x5208", Nonce: "0x7", MaxFeePerGas: "0x2", MaxPriorityFeePerGas: "0x1"}
}

func TestValidateSignedCanonicalAndRejectsMismatches(t *testing.T) {
	rawRec, raw := signedFixture(t)
	got, err := ValidateSigned(rawRec, raw)
	if err != nil || got.Sender != rawRec.Intent.Call.From {
		t.Fatalf("valid signed transaction rejected: %v", err)
	}
	mutate := map[string]func(*IntentRecord, *[]byte){
		"sender": func(r *IntentRecord, _ *[]byte) { r.Intent.Call.From = "0x" + strings.Repeat("4", 40) }, "chain": func(r *IntentRecord, _ *[]byte) { r.Intent.ChainID = 1 }, "nonce": func(r *IntentRecord, _ *[]byte) { r.Intent.Nonce = "8"; r.Intent.Call.Nonce = "0x8" }, "to": func(r *IntentRecord, _ *[]byte) { r.Intent.Call.To = "0x" + strings.Repeat("4", 40) }, "value": func(r *IntentRecord, _ *[]byte) { r.Intent.Call.Value = "0x1" }, "gas": func(r *IntentRecord, _ *[]byte) { r.Intent.Call.Gas = "0x5209" }, "fee": func(r *IntentRecord, _ *[]byte) { r.Intent.Fees.MaxFeePerGas = "3"; r.Intent.Call.MaxFeePerGas = "0x3" }, "data": func(r *IntentRecord, _ *[]byte) { r.Intent.Call.Data = "0x04" }, "type": func(r *IntentRecord, _ *[]byte) { r.Intent.Type = "0x1" }, "digest": func(r *IntentRecord, _ *[]byte) { r.Digest = "00" + r.Digest[2:] }, "noncanonical": func(_ *IntentRecord, b *[]byte) { *b = append([]byte{0}, (*b)...) }}
	for name, f := range mutate {
		t.Run(name, func(t *testing.T) {
			r, b := rawRec, append([]byte{}, raw...)
			f(&r, &b)
			if name != "digest" && name != "noncanonical" {
				body, _ := json.Marshal(r.Intent)
				sum := sha256.Sum256(body)
				r.Digest = hex.EncodeToString(sum[:])
			}
			if _, err := ValidateSigned(r, b); err == nil {
				t.Fatal("invalid signed transaction accepted")
			}
		})
	}
}

func TestValidateSignedRejectsSignedAccessList(t *testing.T) {
	r, _ := signedFixture(t)
	key, _ := crypto.HexToECDSA(strings.Repeat("11", 32))
	to := common.HexToAddress(r.Intent.Call.To)
	tx := types.NewTx(&types.DynamicFeeTx{ChainID: big.NewInt(4663), Nonce: 7, Gas: 21000, GasFeeCap: big.NewInt(2), GasTipCap: big.NewInt(1), To: &to, Data: []byte{1, 2, 3}, AccessList: types.AccessList{{Address: common.HexToAddress("0x4444444444444444444444444444444444444444")}}})
	tx, _ = types.SignTx(tx, types.NewLondonSigner(big.NewInt(4663)), key)
	raw, _ := tx.MarshalBinary()
	if _, err := ValidateSigned(r, raw); err == nil {
		t.Fatal("accepted signed transaction with access list")
	}
}

func TestValidateSignedRejectsSignedLegacy(t *testing.T) {
	r, _ := signedFixture(t)
	key, _ := crypto.HexToECDSA(strings.Repeat("11", 32))
	to := common.HexToAddress(r.Intent.Call.To)
	tx := types.NewTx(&types.LegacyTx{Nonce: 7, Gas: 21000, GasPrice: big.NewInt(2), To: &to, Data: []byte{1, 2, 3}})
	tx, _ = types.SignTx(tx, types.NewEIP155Signer(big.NewInt(4663)), key)
	raw, _ := tx.MarshalBinary()
	if _, err := ValidateSigned(r, raw); err == nil {
		t.Fatal("accepted signed legacy transaction")
	}
}
