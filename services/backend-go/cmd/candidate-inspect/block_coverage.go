package main

import (
	"context"
	"errors"
	"strconv"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func verifyCandidateBlockCoverage(ctx context.Context, rpc *chainrpc.Client, m deployment.Manifest, c readmodel.CandidateSet) error {
	if !c.HistoryEventCoverageVerified {
		_, err := rpc.VerifyReceiptRoot(ctx, c.BlockHash)
		return err
	}
	selected := map[string]bool{}
	for _, a := range c.HistoryEventEmitters {
		selected[a] = true
	}
	for _, module := range m.Contracts {
		if module.Module == "UniswapV4PoolManager" && len(c.Markets) == 0 {
			continue
		}
		if !selected[module.Address] {
			return errors.New("candidate event scope incomplete")
		}
	}
	observer := chainrpc.ScopedObserver{Client: rpc, Emitters: func(context.Context, chainrpc.Header) ([]string, error) { return c.HistoryEventEmitters, nil }}
	n, e := strconv.ParseUint(c.BlockNumber, 10, 64)
	if e != nil {
		return e
	}
	h, err := rpc.Header(ctx, "0x"+strconv.FormatUint(n, 16))
	if err != nil || h.Hash != c.BlockHash {
		return errors.New("candidate coverage anchor mismatch")
	}
	_, err = observer.Observe(ctx, h)
	return err
}
