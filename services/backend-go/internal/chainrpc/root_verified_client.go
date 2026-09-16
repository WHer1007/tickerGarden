package chainrpc

import (
	"context"
	"errors"
)

// RootVerifiedClient preserves the journal RPC interface while requiring the
// exact observed receipt set to match a fresh full-header receipt-root check.
// It does not authenticate consensus or upgrade previously persisted blocks.
type RootVerifiedClient struct{ *Client }

func (c RootVerifiedClient) Observe(ctx context.Context, h Header) (Observation, error) {
	observation, err := c.Client.Observe(ctx, h)
	if err != nil {
		return Observation{}, err
	}
	proof, err := c.Client.VerifyReceiptRoot(ctx, h.Hash)
	if err != nil {
		return Observation{}, err
	}
	commitment, err := ReceiptSetCommitment(observation.Receipts)
	if err != nil || commitment != proof.ReceiptSetHash || len(observation.Receipts) != proof.ReceiptCount {
		return Observation{}, errors.New("observed receipts differ from root-verified receipt set")
	}
	observation.RootProof = &proof
	return observation, nil
}
