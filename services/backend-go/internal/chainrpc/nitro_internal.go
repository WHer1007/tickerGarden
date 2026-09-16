package chainrpc

import (
	"encoding/hex"
	"encoding/json"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rlp"
)

// Encoding and fixed sender from OffchainLabs/go-ethereum commit
// 260bc5dcbd5a16925d7e26145577b2612f30f428, core/types/arb_types.go and
// arbitrum_signer.go. This is an unsigned ArbOS system transaction, NOT a
// signature authorization. Other custom Nitro types remain unsupported.
const arbOSAddress = "0x00000000000000000000000000000000000a4b05"

func decodeNitroInternal(raw []byte, chainID uint64) (AuthenticatedTransaction, []byte, error) {
	fail := func() (AuthenticatedTransaction, []byte, error) {
		return AuthenticatedTransaction{}, nil, ErrTransactionBlock
	}
	var v struct {
		Type, ChainID, Input, Hash, From, To                                     *string
		Nonce, Gas, Value, GasPrice, MaxFeePerGas, MaxPriorityFeePerGas, V, R, S *string
	}
	if json.Unmarshal(raw, &v) != nil || v.Type == nil || *v.Type != "0x6a" || v.ChainID == nil || v.Input == nil || v.Hash == nil || v.From == nil || v.To == nil {
		return fail()
	}
	id, e := Quantity(*v.ChainID)
	if e != nil || id != chainID || id == 0 || !dataPattern.MatchString(*v.Input) || len(*v.Input) > 131074 || !hashPattern.MatchString(*v.Hash) || strings.ToLower(*v.From) != arbOSAddress || strings.ToLower(*v.To) != arbOSAddress {
		return fail()
	}
	// RPC metadata outside the RLP payload must not contradict protocol-fixed
	// semantics. Core fields are required; optional fee/signature fields, when
	// present, must also be zero. They never confer signing authority.
	for _, p := range []*string{v.Nonce, v.Gas, v.Value} {
		if p == nil || *p != "0x0" {
			return fail()
		}
	}
	for _, p := range []*string{v.GasPrice, v.MaxFeePerGas, v.MaxPriorityFeePerGas, v.V, v.R, v.S} {
		if p != nil && *p != "0x0" {
			return fail()
		}
	}
	data, e := hex.DecodeString((*v.Input)[2:])
	if e != nil {
		return fail()
	}
	payload, e := rlp.EncodeToBytes(struct {
		ChainID *big.Int
		Data    []byte
	}{new(big.Int).SetUint64(chainID), data})
	if e != nil {
		return fail()
	}
	encoded := append([]byte{0x6a}, payload...)
	h := crypto.Keccak256Hash(encoded).Hex()
	if !strings.EqualFold(h, *v.Hash) {
		return fail()
	}
	return AuthenticatedTransaction{Hash: h, From: arbOSAddress, To: arbOSAddress, Input: strings.ToLower(*v.Input), Value: "0x0", Type: 0x6a, Authentication: "nitro-internal"}, encoded, nil
}
