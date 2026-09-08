package chainrpc

import (
	"context"
	"errors"
	"math/big"
	"regexp"
)

// GasReceipt is separate from journal receipts so historical journal encodings
// remain stable. Missing fee fields must never be interpreted as zero.
type GasReceipt struct {
	Receipt
	GasUsed           string `json:"gasUsed"`
	EffectiveGasPrice string `json:"effectiveGasPrice"`
}

var gasQuantity = regexp.MustCompile(`^0x(0|[1-9a-f][0-9a-f]*)$`)

func GasQuantity(value string) (*big.Int, error) {
	if len(value) > 66 || !gasQuantity.MatchString(value) {
		return nil, errors.New("invalid gas quantity")
	}
	n, ok := new(big.Int).SetString(value[2:], 16)
	if !ok || n.BitLen() > 256 {
		return nil, errors.New("invalid gas quantity")
	}
	return n, nil
}
func (c *Client) TransactionGasReceipt(ctx context.Context, hash string) (*GasReceipt, error) {
	if !hashPattern.MatchString(hash) {
		return nil, errors.New("invalid transaction hash")
	}
	var r *GasReceipt
	if e := c.callResult(ctx, "eth_getTransactionReceipt", []any{hash}, &r, true); e != nil {
		return nil, e
	}
	if r == nil {
		return nil, nil
	}
	if e := ValidateTransactionReceipt(hash, &r.Receipt); e != nil {
		return nil, e
	}
	gas, e := GasQuantity(r.GasUsed)
	_, pe := GasQuantity(r.EffectiveGasPrice)
	if e != nil || pe != nil || gas.Sign() == 0 {
		return nil, errors.New("missing or invalid receipt gas fields")
	}
	return r, nil
}
