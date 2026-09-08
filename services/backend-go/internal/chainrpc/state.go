package chainrpc

import (
	"context"
	"encoding/hex"
	"errors"
	"math/big"
	"regexp"
)

// State reads are hash-pinned (EIP-1898), with requireCanonical enforced by the
// node. Never fall back to latest when historical state is missing.
func (c *Client) CodeAt(ctx context.Context, address, blockHash string) ([]byte, error) {
	if !addressPattern.MatchString(address) || !hashPattern.MatchString(blockHash) {
		return nil, errors.New("invalid code observation target")
	}
	var result string
	if e := c.call(ctx, "eth_getCode", []any{address, map[string]any{"blockHash": blockHash, "requireCanonical": true}}, &result); e != nil {
		return nil, e
	}
	return stateBytes(result)
}
func (c *Client) CallAt(ctx context.Context, address, data, blockHash string) ([]byte, error) {
	if !addressPattern.MatchString(address) || !hashPattern.MatchString(blockHash) || !dataPattern.MatchString(data) || len(data) > 65538 {
		return nil, errors.New("invalid state observation call")
	}
	var result string
	if e := c.call(ctx, "eth_call", []any{map[string]string{"to": address, "data": data}, map[string]any{"blockHash": blockHash, "requireCanonical": true}}, &result); e != nil {
		return nil, e
	}
	return stateBytes(result)
}
func stateBytes(s string) ([]byte, error) {
	if !dataPattern.MatchString(s) {
		return nil, errors.New("invalid state result encoding")
	}
	return hex.DecodeString(s[2:])
}

var balanceQuantity = regexp.MustCompile(`^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$`)

// BalanceAt preserves the full uint256 quantity as a decimal string.
func (c *Client) BalanceAt(ctx context.Context, address, blockHash string) (string, error) {
	if !addressPattern.MatchString(address) || !hashPattern.MatchString(blockHash) {
		return "", errors.New("invalid balance observation target")
	}
	var result string
	if err := c.call(ctx, "eth_getBalance", []any{address, map[string]any{"blockHash": blockHash, "requireCanonical": true}}, &result); err != nil {
		return "", err
	}
	if !balanceQuantity.MatchString(result) {
		return "", errors.New("invalid balance quantity")
	}
	value, ok := new(big.Int).SetString(result[2:], 16)
	if !ok {
		return "", errors.New("invalid balance quantity")
	}
	return value.String(), nil
}

// SimulateAt executes eth_call with an explicit sender and zero value at one
// canonical hash. It does not sign, estimate a nonce, or submit a transaction.
func (c *Client) SimulateAt(ctx context.Context, from, address, data, blockHash string) ([]byte, error) {
	if !addressPattern.MatchString(from) || from == "0x0000000000000000000000000000000000000000" || !addressPattern.MatchString(address) || !hashPattern.MatchString(blockHash) || !dataPattern.MatchString(data) || len(data) > 65538 {
		return nil, errors.New("invalid transaction simulation")
	}
	var result string
	if err := c.call(ctx, "eth_call", []any{map[string]string{"from": from, "to": address, "data": data, "value": "0x0"}, map[string]any{"blockHash": blockHash, "requireCanonical": true}}, &result); err != nil {
		return nil, err
	}
	return stateBytes(result)
}

// PendingNonce observes the node's pending transaction count. It is not a
// reservation: exclusive account coordination is owned by the durable worker.
func (c *Client) PendingNonce(ctx context.Context, address string) (uint64, error) {
	if !addressPattern.MatchString(address) || address == "0x0000000000000000000000000000000000000000" {
		return 0, errors.New("invalid nonce account")
	}
	var result string
	if err := c.call(ctx, "eth_getTransactionCount", []any{address, "pending"}, &result); err != nil {
		return 0, err
	}
	return Quantity(result)
}

// NonceAtHash reads confirmed account state on the exact canonical preview block.
func (c *Client) NonceAtHash(ctx context.Context, address, hash string) (uint64, error) {
	if !addressPattern.MatchString(address) || address == "0x0000000000000000000000000000000000000000" || !hashPattern.MatchString(hash) {
		return 0, errors.New("invalid nonce state query")
	}
	var result string
	if e := c.call(ctx, "eth_getTransactionCount", []any{address, map[string]any{"blockHash": hash, "requireCanonical": true}}, &result); e != nil {
		return 0, e
	}
	return Quantity(result)
}
