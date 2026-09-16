package chainrpc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

// TransactionLookup is a provider observation, not proof of canonical inclusion
// or signature validity. Callers must separately pin network/genesis and verify
// included blocks/receipts before deriving confirmations or execution outcome.
type TransactionLookup struct {
	Hash             string  `json:"hash"`
	From             string  `json:"from"`
	To               *string `json:"to"`
	Nonce            string  `json:"nonce"`
	BlockHash        *string `json:"blockHash"`
	BlockNumber      *string `json:"blockNumber"`
	TransactionIndex *string `json:"transactionIndex"`
}

func (t TransactionLookup) Pending() bool { return t.BlockHash == nil }

// TransactionByHash returns nil only for an explicit null result. Pending
// requires all three inclusion fields to be explicitly null, not omitted.
func (c *Client) TransactionByHash(ctx context.Context, hash string) (*TransactionLookup, error) {
	fail := func() (*TransactionLookup, error) { return nil, errors.New("invalid transaction lookup") }
	if !hashPattern.MatchString(hash) {
		return fail()
	}
	var raw json.RawMessage
	if err := c.callResult(ctx, "eth_getTransactionByHash", []any{hash}, &raw, true); err != nil {
		return nil, err
	}
	if string(raw) == "null" {
		return nil, nil
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return fail()
	}
	for _, key := range []string{"hash", "from", "to", "nonce", "blockHash", "blockNumber", "transactionIndex"} {
		if _, ok := fields[key]; !ok {
			return fail()
		}
	}
	var t TransactionLookup
	if json.Unmarshal(raw, &t) != nil || !hashPattern.MatchString(t.Hash) || !strings.EqualFold(t.Hash, hash) || !addressPattern.MatchString(t.From) || (t.To != nil && !addressPattern.MatchString(*t.To)) {
		return fail()
	}
	if _, err := Quantity(t.Nonce); err != nil {
		return fail()
	}
	if t.BlockHash == nil {
		if t.BlockNumber != nil || t.TransactionIndex != nil {
			return fail()
		}
	} else {
		if !hashPattern.MatchString(*t.BlockHash) || t.BlockNumber == nil || t.TransactionIndex == nil {
			return fail()
		}
		if _, err := Quantity(*t.BlockNumber); err != nil {
			return fail()
		}
		if _, err := Quantity(*t.TransactionIndex); err != nil {
			return fail()
		}
		*t.BlockHash = strings.ToLower(*t.BlockHash)
	}
	t.Hash = strings.ToLower(t.Hash)
	t.From = strings.ToLower(t.From)
	if t.To != nil {
		*t.To = strings.ToLower(*t.To)
	}
	return &t, nil
}
