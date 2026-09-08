package chainrpc

import (
	"context"
	"errors"
)

// IntentCall is a fully specified zero-value EIP-1559 call used for simulation.
// Quantities use canonical RPC hex encoding; there is no signing or submission.
type IntentCall struct {
	From                 string `json:"from"`
	To                   string `json:"to"`
	Data                 string `json:"data"`
	Value                string `json:"value"`
	Gas                  string `json:"gas"`
	Nonce                string `json:"nonce"`
	MaxFeePerGas         string `json:"maxFeePerGas"`
	MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas"`
}

func (c *Client) SimulateIntentAt(ctx context.Context, call IntentCall, hash string) ([]byte, error) {
	if !addressPattern.MatchString(call.From) || !addressPattern.MatchString(call.To) || call.From == "0x0000000000000000000000000000000000000000" || call.To == "0x0000000000000000000000000000000000000000" || !dataPattern.MatchString(call.Data) || len(call.Data) > 65538 || call.Value != "0x0" || !hashPattern.MatchString(hash) {
		return nil, errors.New("invalid intent simulation")
	}
	gas, e := Quantity(call.Gas)
	if e != nil || gas < 21000 {
		return nil, errors.New("invalid intent gas")
	}
	if _, e = Quantity(call.Nonce); e != nil {
		return nil, e
	}
	if !balanceQuantity.MatchString(call.MaxFeePerGas) || !balanceQuantity.MatchString(call.MaxPriorityFeePerGas) {
		return nil, errors.New("invalid intent fee")
	}
	var result string
	if e = c.call(ctx, "eth_call", []any{call, map[string]any{"blockHash": hash, "requireCanonical": true}}, &result); e != nil {
		return nil, e
	}
	return stateBytes(result)
}
