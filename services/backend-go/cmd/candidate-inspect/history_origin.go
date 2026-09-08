package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

// Check that manifest addresses had no runtime at the parent of the stored
// history start. This does not exclude an earlier destroyed/redeployed instance.
func verifyHistoryOrigin(ctx context.Context, rpc deployment.Observer, m deployment.Manifest, c readmodel.CandidateSet) error {
	bad := errors.New("candidate history origin unavailable or excludes deployed runtime")
	if rpc == nil || c.ChainID != m.ChainID || len(m.Contracts) == 0 || len(m.Contracts) > 256 || requireCandidateHistoryRoots(c) != nil {
		return bad
	}
	startTag := fmt.Sprintf("0x%x", c.HistoryStartBlock)
	start, err := rpc.Header(ctx, startTag)
	if err != nil || start.Number != startTag || start.Hash != c.HistoryStartHash {
		return bad
	}
	if m.Bootstrap != nil {
		if m.Bootstrap.BusinessStartBlock != c.HistoryStartBlock {
			return bad
		}
		f, err := os.Open(os.Getenv("TG_DEPLOYMENT_BOOTSTRAP_FILE"))
		if err != nil {
			return bad
		}
		defer f.Close()
		raw, err := io.ReadAll(io.LimitReader(f, deployment.MaxBootstrapBytes+1))
		if err != nil {
			return bad
		}
		return deployment.VerifyBootstrap(ctx, rpc, m, start, raw)
	}
	if c.HistoryStartBlock == 0 {
		if start.Hash != m.GenesisHash {
			return bad
		}
		return nil
	}
	parentTag := fmt.Sprintf("0x%x", c.HistoryStartBlock-1)
	parent, err := rpc.Header(ctx, parentTag)
	if err != nil || parent.Number != parentTag || parent.Hash != start.ParentHash {
		return bad
	}
	for _, contract := range m.Contracts {
		code, err := rpc.CodeAt(ctx, contract.Address, parent.Hash)
		if err != nil || len(code) != 0 {
			return bad
		}
	}
	again, err := rpc.Header(ctx, parentTag)
	if err != nil || again.Number != parent.Number || again.Hash != parent.Hash {
		return bad
	}
	again, err = rpc.Header(ctx, startTag)
	if err != nil || again.Number != start.Number || again.Hash != start.Hash || again.ParentHash != parent.Hash {
		return bad
	}
	return nil
}
