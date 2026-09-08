package settlement

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/ethereum/go-ethereum/core/types"
	"math/big"
	"strconv"
	"strings"
	"tickergarden/backend/internal/chainrpc"
)

type SignedTransaction struct {
	TransactionHash string `json:"transactionHash"`
	RawTransaction  string `json:"rawTransaction"`
	IntentDigest    string `json:"intentDigest"`
	Sender          string `json:"sender"`
}

// ValidateSigned proves byte/field/sender equality, not current authorization.
func ValidateSigned(r IntentRecord, raw []byte) (SignedTransaction, error) {
	body, err := json.Marshal(r.Intent)
	sum := sha256.Sum256(body)
	if err != nil || hex.EncodeToString(sum[:]) != r.Digest || len(raw) == 0 || len(raw) > 16384 || r.Intent.Type != "0x2" || r.Intent.Status != "intent_prepared" {
		return SignedTransaction{}, ErrIntent
	}
	in := r.Intent
	var tx types.Transaction
	if tx.UnmarshalBinary(raw) != nil || tx.Type() != types.DynamicFeeTxType || tx.To() == nil || len(tx.AccessList()) != 0 {
		return SignedTransaction{}, ErrIntent
	}
	encoded, e := tx.MarshalBinary()
	if e != nil || !bytes.Equal(encoded, raw) {
		return SignedTransaction{}, ErrIntent
	}
	nonce, e := chainrpc.Quantity(in.Call.Nonce)
	if e != nil || in.Nonce != strconv.FormatUint(nonce, 10) {
		return SignedTransaction{}, ErrIntent
	}
	gas, e := chainrpc.Quantity(in.Call.Gas)
	if e != nil {
		return SignedTransaction{}, ErrIntent
	}
	fee, e := amount(in.Fees.MaxFeePerGas)
	if e != nil {
		return SignedTransaction{}, ErrIntent
	}
	tip, e := amount(in.Fees.MaxPriorityFeePerGas)
	if e != nil {
		return SignedTransaction{}, ErrIntent
	}
	if in.Call.MaxFeePerGas != "0x"+fee.Text(16) || in.Call.MaxPriorityFeePerGas != "0x"+tip.Text(16) || !strings.HasPrefix(in.Call.Data, "0x") {
		return SignedTransaction{}, ErrIntent
	}
	data, e := hex.DecodeString(in.Call.Data[2:])
	if e != nil {
		return SignedTransaction{}, ErrIntent
	}
	chain := new(big.Int).SetUint64(in.ChainID)
	if tx.ChainId().Cmp(chain) != 0 || tx.Nonce() != nonce || tx.Gas() != gas || tx.GasFeeCap().Cmp(fee) != 0 || tx.GasTipCap().Cmp(tip) != 0 || tx.Value().Sign() != 0 || in.Call.Value != "0x0" || strings.ToLower(tx.To().Hex()) != in.Call.To || !bytes.Equal(tx.Data(), data) {
		return SignedTransaction{}, ErrIntent
	}
	from, e := types.Sender(types.NewLondonSigner(chain), &tx)
	if e != nil || strings.ToLower(from.Hex()) != in.Call.From {
		return SignedTransaction{}, ErrIntent
	}
	return SignedTransaction{TransactionHash: strings.ToLower(tx.Hash().Hex()), RawTransaction: "0x" + hex.EncodeToString(raw), IntentDigest: r.Digest, Sender: in.Call.From}, nil
}
