package integration

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/treasury"
)

func testTreasuryLifecycle(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string, rpc *requestDiscoveryRPC, key, sender string, now uint64) {
	t.Helper()
	original := append([]byte(nil), rpc.calls[key]...)
	defer func() { rpc.calls[key] = original; rpc.reorgAt = 0 }()
	c, err := treasury.ReadCandidate(ctx, pool, id)
	if err != nil {
		t.Fatal(err)
	}
	put := func(index int, n uint64) {
		b, _ := hex.DecodeString(fmt.Sprintf("%064x", n))
		copy(rpc.calls[key][index*32:(index+1)*32], b)
	}
	put(6, 2)
	put(2, now+1)
	put(3, 0)
	put(5, uint64(c.Dataset.LeafCount))
	for index, value := range map[int]string{11: c.Dataset.MerkleRoot, 12: c.Dataset.DatasetHash} {
		b, _ := hex.DecodeString(value[2:])
		copy(rpc.calls[key][index*32:(index+1)*32], b)
	}
	n, _ := new(big.Int).SetString(c.Dataset.TotalTwab, 10)
	copy(rpc.calls[key][15*32:16*32], n.FillBytes(make([]byte, 32)))
	sim := &lifecycleRPC{requestDiscoveryRPC: rpc, sender: sender}
	pending, err := treasury.ObservePendingRoot(ctx, sim, rpc.manifest, c.Input.MarketID, c.Input.EpochID)
	if err != nil || pending.FinalizeReady || pending.FinalizeEffect != "claiming" || pending.TransactionSubmission {
		t.Fatal("pending observation", pending, err)
	}
	if _, err = treasury.PrepareFinalization(ctx, pool, sim, rpc.manifest, id, sender); err == nil {
		t.Fatal("early finalize accepted")
	}
	put(2, now)
	plan, err := treasury.PrepareFinalization(ctx, pool, sim, rpc.manifest, id, sender)
	if err != nil || plan.TransactionSubmission || plan.CandidateID != id || plan.ReviewID == "" || len(plan.Data) != 138 {
		t.Fatal("finalize at boundary", plan, err)
	}
	b, _ := hex.DecodeString(hash(998)[2:])
	copy(rpc.calls[key][11*32:12*32], b)
	if _, err = treasury.PrepareFinalization(ctx, pool, sim, rpc.manifest, id, sender); err == nil {
		t.Fatal("foreign root finalized")
	}
	if _, err = treasury.PrepareCancellation(ctx, sim, rpc.manifest, c.Input.MarketID, c.Input.EpochID, sender, c.Dataset.MerkleRoot, c.Dataset.DatasetHash, hash(999)); err == nil {
		t.Fatal("wrong cancellation target accepted")
	}
	plan, err = treasury.PrepareCancellation(ctx, sim, rpc.manifest, c.Input.MarketID, c.Input.EpochID, sender, hash(998), c.Dataset.DatasetHash, hash(999))
	if err != nil || plan.TransactionSubmission || len(plan.Data) != 202 {
		t.Fatal("unknown root cancellation", plan, err)
	}
	timestamp := rpc.block.Timestamp
	rpc.block.Timestamp = fmt.Sprintf("0x%x", now-121)
	if _, err = treasury.ObservePendingRoot(ctx, sim, rpc.manifest, c.Input.MarketID, c.Input.EpochID); err == nil {
		t.Fatal("stale pending observation accepted")
	}
	rpc.block.Timestamp = timestamp
	if _, err = treasury.PrepareCancellation(ctx, sim, rpc.manifest, c.Input.MarketID, c.Input.EpochID, fmt.Sprintf("0x%040x", 991), hash(998), c.Dataset.DatasetHash, hash(999)); err == nil {
		t.Fatal("unauthorized cancellation accepted")
	}
	sim.revert = true
	if _, err = treasury.PrepareCancellation(ctx, sim, rpc.manifest, c.Input.MarketID, c.Input.EpochID, sender, hash(998), c.Dataset.DatasetHash, hash(999)); err == nil {
		t.Fatal("reverting cancellation accepted")
	}
	sim.revert = false
	sim.reorg = true
	if _, err = treasury.PrepareCancellation(ctx, sim, rpc.manifest, c.Input.MarketID, c.Input.EpochID, sender, hash(998), c.Dataset.DatasetHash, hash(999)); err == nil {
		t.Fatal("reorg cancellation accepted")
	}
}

type lifecycleRPC struct {
	*requestDiscoveryRPC
	sender        string
	revert, reorg bool
}

func (r *lifecycleRPC) SimulateAt(_ context.Context, from, to, data, block string) ([]byte, error) {
	if r.revert || from != r.sender || block != r.block.Hash || to == "" {
		return nil, errors.New("simulation denied")
	}
	if !((len(data) == 138 && data[:10] == deployment.Hash([]byte("finalizeRoot(bytes32,uint32)"))[:10]) || (len(data) == 202 && data[:10] == deployment.Hash([]byte("cancelPendingRoot(bytes32,uint32,bytes32)"))[:10])) {
		return nil, errors.New("incorrect lifecycle ABI")
	}
	if r.reorg {
		r.reorgAt = r.headers + 1
	}
	return []byte{}, nil
}
