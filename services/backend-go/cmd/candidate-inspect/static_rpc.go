package main

import (
	"context"
	"errors"
	"strconv"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

// Verify manifest runtime identities at this candidate's finalized block. This
// does not authenticate dynamic instances or all historical event blocks.
func verifyStaticCandidate(ctx context.Context, rpc deployment.Observer, manifest deployment.Manifest, candidate readmodel.CandidateSet) error {
	bad := errors.New("candidate static RPC verification failed")
	if rpc == nil || candidate.ChainID != manifest.ChainID || !candidate.EmitterAddressBindingsVerified || !candidate.ProtocolEventInventoryVerified {
		return bad
	}
	n, e := readmodel.Height(candidate.BlockNumber)
	if e != nil {
		return bad
	}
	number := "0x" + strconv.FormatUint(n, 16)
	checkFinalized := func() error {
		finalized, e := rpc.Header(ctx, "finalized")
		if e != nil {
			return bad
		}
		height, e := finalized.Height()
		if e != nil || height < n {
			return bad
		}
		if height == n && finalized.Hash != candidate.BlockHash {
			return bad
		}
		return nil
	}
	if checkFinalized() != nil {
		return bad
	}
	block, e := rpc.Header(ctx, number)
	if e != nil || block.Number != number || block.Hash != candidate.BlockHash {
		return bad
	}
	if _, e := deployment.Verify(ctx, rpc, manifest, block); e != nil {
		return bad
	}
	if checkFinalized() != nil {
		return bad
	}
	latest, e := rpc.Header(ctx, number)
	if e != nil || latest.Number != number || latest.Hash != candidate.BlockHash {
		return bad
	}
	return nil
}
