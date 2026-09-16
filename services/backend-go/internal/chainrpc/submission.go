package chainrpc

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
)

// ErrSubmissionUnknown means the caller must retain the exact signed bytes and
// reconcile by their hash. Even an RPC error cannot prove non-submission.
var ErrSubmissionUnknown = errors.New("transaction submission outcome unknown")

// SendRawTransaction makes one attempt, with no application retry. The caller
// must validate and durably record the authorized signed intent before calling.
// An acknowledged hash is not evidence of inclusion or execution success.
func (c *Client) SendRawTransaction(ctx context.Context, raw []byte) (string, error) {
	if len(raw) == 0 || len(raw) > 16384 {
		return "", errors.New("invalid signed transaction size")
	}
	hash := crypto.Keccak256Hash(raw).Hex()
	var result string
	if err := c.call(ctx, "eth_sendRawTransaction", []any{"0x" + hex.EncodeToString(raw)}, &result); err != nil {
		return hash, ErrSubmissionUnknown
	}
	if !hashPattern.MatchString(result) || !strings.EqualFold(result, hash) {
		return hash, ErrSubmissionUnknown
	}
	return hash, nil
}

// TransactionReceipt returns nil only for an explicit JSON null. Absence is
// not proof that a transaction was never submitted. This validates provenance
// within the response; callers must separately verify canonicality/finality.
func (c *Client) TransactionReceipt(ctx context.Context, hash string) (*Receipt, error) {
	if !hashPattern.MatchString(hash) {
		return nil, errors.New("invalid transaction hash")
	}
	var r *Receipt
	if err := c.callResult(ctx, "eth_getTransactionReceipt", []any{hash}, &r, true); err != nil {
		return nil, err
	}
	if r == nil {
		return nil, nil
	}
	if err := ValidateTransactionReceipt(hash, r); err != nil {
		return nil, err
	}
	return r, nil
}

// ValidateTransactionReceipt checks a non-null receipt independently of transport.
func ValidateTransactionReceipt(hash string, r *Receipt) error {
	if !hashPattern.MatchString(hash) || r == nil {
		return errors.New("invalid transaction receipt")
	}
	_, he := Quantity(r.BlockNumber)
	_, ie := Quantity(r.TransactionIndex)
	if !strings.EqualFold(r.TransactionHash, hash) || !hashPattern.MatchString(r.BlockHash) || he != nil || ie != nil || (r.Status != "0x0" && r.Status != "0x1") || r.Logs == nil || (r.Status == "0x0" && len(r.Logs) != 0) {
		return errors.New("invalid transaction receipt")
	}
	var previous uint64
	for i, l := range r.Logs {
		index, err := Quantity(l.LogIndex)
		if err != nil || (i > 0 && index <= previous) || l.Removed || !strings.EqualFold(l.TransactionHash, hash) || l.TransactionIndex != r.TransactionIndex || !strings.EqualFold(l.BlockHash, r.BlockHash) || l.BlockNumber != r.BlockNumber || !addressPattern.MatchString(l.Address) || !dataPattern.MatchString(l.Data) || l.Topics == nil || len(l.Topics) > 4 {
			return errors.New("invalid transaction receipt log")
		}
		for _, topic := range l.Topics {
			if !hashPattern.MatchString(topic) {
				return errors.New("invalid transaction receipt topic")
			}
		}
		previous = index
	}
	return nil
}
