package holderledger

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type replayRPC struct {
	parent, block chainrpc.Header
	txs           chainrpc.TransactionBlock
	observation   chainrpc.Observation
	traces        map[string]chainrpc.CallTrace
	reorg         bool
	traceReads    int
}

func (f *replayRPC) ChainID(context.Context) (uint64, error) { return 1, nil }
func (f *replayRPC) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	if tag == f.parent.Number {
		return f.parent, nil
	}
	if tag == "finalized" {
		return f.block, nil
	}
	if tag == f.block.Number {
		h := f.block
		if f.reorg {
			h.Hash = f.parent.Hash
		}
		return h, nil
	}
	return chainrpc.Header{}, ErrInput
}
func (f *replayRPC) CodeAt(_ context.Context, _ string, h string) ([]byte, error) {
	if h != f.block.Hash && h != f.parent.Hash {
		return nil, ErrInput
	}
	return []byte{1}, nil
}
func (f *replayRPC) CallAt(context.Context, string, string, string) ([]byte, error) {
	return nil, ErrInput
}
func (f *replayRPC) AuthenticatedTransactions(context.Context, uint64, string) (chainrpc.TransactionBlock, error) {
	return f.txs, nil
}
func (f *replayRPC) Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error) {
	return f.observation, nil
}
func (f *replayRPC) TransactionCallTrace(_ context.Context, h string) (chainrpc.CallTrace, error) {
	f.traceReads++
	v, ok := f.traces[h]
	if !ok {
		return v, ErrInput
	}
	return v, nil
}
func replayCase(t *testing.T) (*Ledger, *replayRPC, ReconcileConfig) {
	t.Helper()
	l := traceLedger(t)
	p := chainrpc.Header{Number: "0x0", Timestamp: "0x0", Hash: "0x" + strings.Repeat("a", 64), ParentHash: "0x" + strings.Repeat("0", 64)}
	b := chainrpc.Header{Number: "0x1", Timestamp: "0x1", Hash: "0x" + strings.Repeat("b", 64), ParentHash: p.Hash}
	f := &replayRPC{parent: p, block: b, traces: map[string]chainrpc.CallTrace{}}
	f.txs = chainrpc.TransactionBlock{Header: b, ReceiptRoot: "0x" + strings.Repeat("c", 64)}
	for i := 0; i < 2; i++ {
		h := fmt.Sprintf("0x%064x", i+1)
		tx := chainrpc.AuthenticatedTransaction{Hash: h, From: a, To: distributor, Input: checkpointInput(), Value: "0x0", Type: 2}
		f.txs.Transactions = append(f.txs.Transactions, tx)
		f.traces[h] = traceCall(a, distributor, checkpointInput(), "0x")
		f.observation.Receipts = append(f.observation.Receipts, chainrpc.Receipt{TransactionHash: h, TransactionIndex: fmt.Sprintf("0x%x", i), BlockHash: b.Hash, BlockNumber: b.Number, Status: "0x1", Logs: []chainrpc.Log{}})
	}
	commit, e := chainrpc.ReceiptSetCommitment(f.observation.Receipts)
	if e != nil {
		t.Fatal(e)
	}
	f.observation.RootProof = &chainrpc.ReceiptRootVerification{BlockHash: b.Hash, ReceiptRoot: f.txs.ReceiptRoot, ReceiptCount: 2, ReceiptSetHash: commit}
	c := ReconcileConfig{ChainID: 1, GenesisHash: p.Hash, Binding: traceBinding(), Quote: zero, TokenCodeHash: deployment.Hash([]byte{1}), DistributorCodeHash: deployment.Hash([]byte{1}), MaxAccounts: 10}
	return l, f, c
}
func TestReplayNextBlockAtomicAndComplete(t *testing.T) {
	for _, kind := range []string{"valid", "missing-last-trace", "forged-from", "forged-input", "forged-value", "wrong-status", "receipt-missing", "root-missing", "root-mismatch", "receipt-order", "reorg-after-replay", "unsupported-block", "gap", "cancel", "dense"} {
		t.Run(kind, func(t *testing.T) {
			l, f, c := replayCase(t)
			ctx := context.Background()
			before, _ := json.Marshal(l)
			last := f.txs.Transactions[1].Hash
			switch kind {
			case "missing-last-trace":
				delete(f.traces, last)
			case "forged-from":
				v := f.traces[last]
				v.From = token
				f.traces[last] = v
			case "forged-input":
				v := f.traces[last]
				v.Input = "0x"
				f.traces[last] = v
			case "forged-value":
				v := f.traces[last]
				v.Value = "0x1"
				f.traces[last] = v
			case "wrong-status":
				v := f.traces[last]
				v.Error = "reverted"
				f.traces[last] = v
			case "receipt-missing":
				f.observation.Receipts = f.observation.Receipts[:1]
			case "root-missing":
				f.observation.RootProof = nil
			case "root-mismatch":
				f.observation.RootProof.ReceiptRoot = f.parent.Hash
			case "receipt-order":
				f.observation.Receipts[0], f.observation.Receipts[1] = f.observation.Receipts[1], f.observation.Receipts[0]
			case "reorg-after-replay":
				f.reorg = true
			case "unsupported-block":
				f.txs.Header.Hash = f.parent.Hash
			case "gap":
				f.parent.Number = "0x9"
			case "cancel":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			case "dense":
				f.txs.Transactions = make([]chainrpc.AuthenticatedTransaction, 257)
			}
			out, e := l.ReplayNextBlock(ctx, f, c, f.parent, f.block)
			if kind == "valid" {
				if e != nil || out.Actions != 2 || out.Transactions != 2 || f.traceReads != 2 || l.UpdatedAt != 1 || !strings.HasPrefix(out.EvidenceDigest, "sha256:") {
					t.Fatalf("valid %+v %v", out, e)
				}
			} else {
				if e == nil {
					t.Fatal("invalid block accepted", kind)
				}
				after, _ := json.Marshal(l)
				if !reflect.DeepEqual(before, after) {
					t.Fatal("partial replay committed", kind)
				}
			}
			if out.HistoryVerified || out.PublicationEligible {
				t.Fatal("one block cannot authorize history/publication")
			}
		})
	}
}

func TestReplayEmptyAndRevertedTransactions(t *testing.T) {
	for _, empty := range []bool{false, true} {
		l, f, c := replayCase(t)
		if empty {
			f.txs.Transactions = []chainrpc.AuthenticatedTransaction{}
			f.observation.Receipts = []chainrpc.Receipt{}
		} else {
			h := f.txs.Transactions[0].Hash
			v := f.traces[h]
			v.Error = "execution reverted"
			f.traces[h] = v
			f.observation.Receipts[0].Status = "0x0"
		}
		commit, e := chainrpc.ReceiptSetCommitment(f.observation.Receipts)
		if e != nil {
			t.Fatal(e)
		}
		f.observation.RootProof.ReceiptSetHash = commit
		f.observation.RootProof.ReceiptCount = len(f.observation.Receipts)
		r, e := l.ReplayNextBlock(t.Context(), f, c, f.parent, f.block)
		want := 1
		if empty {
			want = 0
		}
		if e != nil || r.Actions != want || r.Transactions != len(f.txs.Transactions) {
			t.Fatalf("empty=%v %+v %v", empty, r, e)
		}
	}
}
