package chainrpc

import (
	"encoding/json"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rlp"
)

// Deposit encoding: OffchainLabs/go-ethereum 260bc5dcbd5a16925d7e26145577b2612f30f428,
// core/types/arb_types.go. From is committed by the transaction trie, not an
// ECDSA authorization. This does not independently prove the L1 deposit origin.
func decodeNitroDeposit(raw []byte, chainID uint64) (AuthenticatedTransaction, []byte, error) {
	fail := func() (AuthenticatedTransaction, []byte, error) {
		return AuthenticatedTransaction{}, nil, ErrTransactionBlock
	}
	var v struct {
		Type, ChainID, RequestID, From, To, Value, Input, Hash            *string
		Nonce, Gas, GasPrice, MaxFeePerGas, MaxPriorityFeePerGas, V, R, S *string
	}
	if json.Unmarshal(raw, &v) != nil {
		return fail()
	}
	for _, p := range []*string{v.Type, v.ChainID, v.RequestID, v.From, v.To, v.Value, v.Input, v.Hash, v.Nonce, v.Gas} {
		if p == nil {
			return fail()
		}
	}
	if *v.Type != "0x64" || *v.Input != "0x" || !hashPattern.MatchString(*v.RequestID) || !hashPattern.MatchString(*v.Hash) || !addressPattern.MatchString(*v.From) || !addressPattern.MatchString(*v.To) {
		return fail()
	}
	id, e := Quantity(*v.ChainID)
	if e != nil || id == 0 || id != chainID {
		return fail()
	}
	value, e := hexutil.DecodeBig(*v.Value)
	if e != nil {
		return fail()
	}
	for _, p := range []*string{v.Nonce, v.Gas, v.GasPrice, v.MaxFeePerGas, v.MaxPriorityFeePerGas, v.V, v.R, v.S} {
		if p != nil && *p != "0x0" {
			return fail()
		}
	}
	payload, e := rlp.EncodeToBytes(struct {
		ChainID   *big.Int
		RequestID common.Hash
		From      common.Address
		To        common.Address
		Value     *big.Int
	}{new(big.Int).SetUint64(id), common.HexToHash(*v.RequestID), common.HexToAddress(*v.From), common.HexToAddress(*v.To), value})
	if e != nil {
		return fail()
	}
	encoded := append([]byte{0x64}, payload...)
	hash := crypto.Keccak256Hash(encoded).Hex()
	if !strings.EqualFold(hash, *v.Hash) {
		return fail()
	}
	return AuthenticatedTransaction{Hash: hash, From: strings.ToLower(*v.From), To: strings.ToLower(*v.To), Input: "0x", Value: hexutil.EncodeBig(value), Type: 0x64, Authentication: "nitro-deposit"}, encoded, nil
}
