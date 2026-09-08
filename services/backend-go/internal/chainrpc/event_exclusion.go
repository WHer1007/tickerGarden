package chainrpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// EventExclusionBundle reads only a header. Inconclusive blooms require a
// separate receipt proof; this method never falls back to unrelated receipts.
func (c *Client) EventExclusionBundle(ctx context.Context, number uint64, emitters []string) (ReceiptRootBundle, error) {
	var raw json.RawMessage
	if err := c.call(ctx, "eth_getBlockByNumber", []any{fmt.Sprintf("0x%x", number), false}, &raw); err != nil {
		return ReceiptRootBundle{}, err
	}
	var h Header
	if json.Unmarshal(raw, &h) != nil || h.Number != fmt.Sprintf("0x%x", number) {
		return ReceiptRootBundle{}, errors.New("event exclusion height mismatch")
	}
	if err := VerifyEventExclusion(raw, h.Hash, emitters); err != nil {
		return ReceiptRootBundle{}, err
	}
	return ReceiptRootBundle{Header: raw}, nil
}

// VerifyEventExclusion authenticates a header and proves that none of the
// supplied emitters produced logs. A positive bloom is inconclusive and fails
// closed. The caller must authenticate the canonical anchor and supply the
// complete emitter inventory. This is not a full receipt-root verification.
func VerifyEventExclusion(raw json.RawMessage, hash string, emitters []string) error {
	bad := errors.New("header event exclusion unavailable or inconclusive")
	if !hashPattern.MatchString(hash) || len(raw) == 0 || len(raw) > 32<<20 || len(emitters) == 0 {
		return bad
	}
	var header types.Header
	var metadata struct {
		Hash   string `json:"hash"`
		Number string `json:"number"`
	}
	if json.Unmarshal(raw, &header) != nil || json.Unmarshal(raw, &metadata) != nil || header.Number == nil || !header.Number.IsUint64() || header.Hash().Hex() != hash || metadata.Hash != hash || metadata.Number != fmt.Sprintf("0x%x", header.Number) {
		return bad
	}
	for _, address := range emitters {
		if len(address) != 42 || !common.IsHexAddress(address) || common.HexToAddress(address) == (common.Address{}) || types.BloomLookup(header.Bloom, common.HexToAddress(address)) {
			return bad
		}
	}
	return nil
}
