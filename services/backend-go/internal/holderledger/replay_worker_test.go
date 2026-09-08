package holderledger

import (
	"context"
	"errors"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

type replayWorkerStore struct {
	stored   StoredCheckpoint
	ledger   *Ledger
	replay   BlockReplay
	loadErr  error
	advErr   error
	advances int
	target   chainrpc.Header
}

func (s *replayWorkerStore) Load(context.Context, CheckpointScope) (StoredCheckpoint, *Ledger, string, error) {
	return s.stored, s.ledger, "digest", s.loadErr
}
func (s *replayWorkerStore) Advance(_ context.Context, _ BlockReplayRPC, _ CheckpointScope, target chainrpc.Header) (BlockReplay, error) {
	s.advances++
	s.target = target
	return s.replay, s.advErr
}

func TestReplayWorkerIdleAndAdvance(t *testing.T) {
	for _, idle := range []bool{true, false} {
		t.Run(map[bool]string{true: "idle", false: "advance"}[idle], func(t *testing.T) {
			l, rpc, cfg := replayCase(t)
			stored := StoredCheckpoint{Revision: 4, Block: rpc.parent}
			if idle {
				stored.Block = rpc.block
			}
			store := &replayWorkerStore{stored: stored, ledger: l, replay: BlockReplay{Block: rpc.block}}
			worker := ReplayWorker{Store: store, RPC: rpc, Scope: CheckpointScope{Config: cfg, MarketID: l.MarketID, Token: l.Token}}
			got, err := worker.Step(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			if idle {
				if got.Action != "idle" || store.advances != 0 || got.Revision != 4 {
					t.Fatal(got, store.advances)
				}
			} else if got.Action != "advanced" || store.advances != 1 || store.target != rpc.block || got.Revision != 5 || got.Replay == nil {
				t.Fatal(got, store.advances)
			}
			if got.HistoryVerified || got.PublicationEligible {
				t.Fatal("worker granted eligibility")
			}
		})
	}
}

func TestReplayWorkerStopsBeforeAdvance(t *testing.T) {
	for _, mode := range []string{"load", "chain", "genesis", "head", "code", "finalized-behind", "gap", "advance"} {
		t.Run(mode, func(t *testing.T) {
			l, rpc, cfg := replayCase(t)
			store := &replayWorkerStore{stored: StoredCheckpoint{Revision: 1, Block: rpc.parent}, ledger: l}
			switch mode {
			case "load":
				store.loadErr = ErrCheckpoint
			case "chain":
				cfg.ChainID = 2
			case "genesis":
				cfg.GenesisHash = "0x" + string(make([]byte, 64))
			case "head":
				store.stored.Block.Hash = rpc.block.Hash
			case "code":
				cfg.TokenCodeHash = "0x" + string(make([]byte, 64))
			case "finalized-behind":
				store.stored.Block = rpc.block
				rpc.block = rpc.parent
			case "gap":
				rpc.block.ParentHash = "0x" + string(make([]byte, 64))
			case "advance":
				store.advErr = ErrCheckpoint
			}
			worker := ReplayWorker{Store: store, RPC: rpc, Scope: CheckpointScope{Config: cfg, MarketID: l.MarketID, Token: l.Token}}
			_, err := worker.Step(t.Context())
			if !errors.Is(err, ErrReplayWorker) || (mode != "advance" && store.advances != 0) {
				t.Fatal(mode, err, store.advances)
			}
		})
	}
}
