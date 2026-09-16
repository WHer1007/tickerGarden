package holderledger

import (
	"context"
	"errors"
	"fmt"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

var ErrReplayWorker = errors.New("holder replay worker stopped on incomplete or inconsistent evidence")

type ReplayCheckpointStore interface {
	Load(context.Context, CheckpointScope) (StoredCheckpoint, *Ledger, string, error)
	Advance(context.Context, BlockReplayRPC, CheckpointScope, chainrpc.Header) (BlockReplay, error)
}

type ReplayWorker struct {
	Store ReplayCheckpointStore
	RPC   BlockReplayRPC
	Scope CheckpointScope
}

type ReplayWorkerResult struct {
	Action              string          `json:"action"`
	Revision            int64           `json:"revision"`
	Head                chainrpc.Header `json:"head"`
	Replay              *BlockReplay    `json:"replay,omitempty"`
	HistoryVerified     bool            `json:"historyVerified"`
	PublicationEligible bool            `json:"publicationEligible"`
}

// Step validates the stored head even when idle, then advances exactly one
// finalized child block. Evidence failures and reorgs stop the worker; no block
// is skipped and no checkpoint is reset automatically.
func (w ReplayWorker) Step(ctx context.Context) (ReplayWorkerResult, error) {
	fail := func() (ReplayWorkerResult, error) { return ReplayWorkerResult{}, ErrReplayWorker }
	if w.Store == nil || w.RPC == nil {
		return fail()
	}
	key, err := scopeKey(w.Scope)
	if err != nil || key == "" {
		return fail()
	}
	stored, _, _, err := w.Store.Load(ctx, w.Scope)
	if err != nil {
		return fail()
	}
	headHeight, err := stored.Block.Height()
	if err != nil || headHeight >= 1<<63-1 {
		return fail()
	}
	chainID, err := w.RPC.ChainID(ctx)
	if err != nil || chainID != w.Scope.Config.ChainID {
		return fail()
	}
	genesis, err := w.RPC.Header(ctx, "0x0")
	if err != nil || genesis.Hash != w.Scope.Config.GenesisHash {
		return fail()
	}
	canonicalHead, err := w.RPC.Header(ctx, stored.Block.Number)
	if err != nil || canonicalHead != stored.Block {
		return fail()
	}
	for _, target := range []struct{ address, codeHash string }{
		{w.Scope.Token, w.Scope.Config.TokenCodeHash},
		{w.Scope.Config.Binding.Distributor, w.Scope.Config.DistributorCodeHash},
	} {
		code, readErr := w.RPC.CodeAt(ctx, target.address, stored.Block.Hash)
		if readErr != nil || len(code) == 0 || deployment.Hash(code) != target.codeHash {
			return fail()
		}
	}
	finalized, err := w.RPC.Header(ctx, "finalized")
	if err != nil {
		return fail()
	}
	finalHeight, err := finalized.Height()
	if err != nil || finalHeight < headHeight {
		return fail()
	}
	result := ReplayWorkerResult{Action: "idle", Revision: stored.Revision, Head: stored.Block}
	if finalHeight == headHeight {
		return result, nil
	}
	nextNumber := fmt.Sprintf("0x%x", headHeight+1)
	next, err := w.RPC.Header(ctx, nextNumber)
	if err != nil || next.Number != nextNumber || next.ParentHash != stored.Block.Hash {
		return fail()
	}
	replay, err := w.Store.Advance(ctx, w.RPC, w.Scope, next)
	if err != nil {
		return fail()
	}
	result.Action = "advanced"
	result.Revision++
	result.Head = next
	result.Replay = &replay
	return result, nil
}
