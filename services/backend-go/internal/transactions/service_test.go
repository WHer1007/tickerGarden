package transactions

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"time"
)

type journalFixture struct {
	value  JournalStatus
	calls  int
	change bool
}

func (j *journalFixture) Load(context.Context, string) (JournalStatus, error) {
	j.calls++
	out := j.value
	if j.change && j.calls > 1 {
		out.HeadHash = hash(99)
	}
	return out, nil
}

type rpcFixture struct {
	lookup                                             *chainrpc.TransactionLookup
	receipt                                            *chainrpc.Receipt
	headCalls                                          int
	change, wrongChain, wrongGenesis, wrongBlock, fail bool
}

func (r *rpcFixture) ChainID(context.Context) (uint64, error) {
	if r.wrongChain {
		return 1, nil
	}
	return 4663, nil
}
func (r *rpcFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	n := uint64(0)
	switch tag {
	case "latest":
		n = 12
		r.headCalls++
		if r.change && r.headCalls > 1 {
			n = 13
		}
	case "finalized":
		n = 8
	default:
		var e error
		n, e = chainrpc.Quantity(tag)
		if e != nil {
			return chainrpc.Header{}, e
		}
	}
	h := hash(int(n))
	if n == 0 {
		h = hash(500)
		if r.wrongGenesis {
			h = hash(999)
		}
	}
	if r.wrongBlock && n == 9 {
		h = hash(99)
	}
	return chainrpc.Header{Number: fmt.Sprintf("0x%x", n), Hash: h}, nil
}
func (r *rpcFixture) TransactionByHash(context.Context, string) (*chainrpc.TransactionLookup, error) {
	if r.fail {
		return nil, errors.New("offline")
	}
	return r.lookup, nil
}
func (r *rpcFixture) TransactionReceipt(context.Context, string) (*chainrpc.Receipt, error) {
	return r.receipt, nil
}
func serviceFixture(t *testing.T) (*Service, *journalFixture, *rpcFixture) {
	t.Helper()
	status, e := DeriveStatus(observation())
	if e != nil {
		t.Fatal(e)
	}
	j := &journalFixture{value: JournalStatus{Status: status, Source: "indexed_journal", IndexedFrom: "1", ObservedAt: time.Now(), PendingLookup: "not_performed"}}
	r := &rpcFixture{}
	return &Service{j, r, 4663, hash(500)}, j, r
}
func TestServiceRPCPendingAndLiveInclusion(t *testing.T) {
	s, _, r := serviceFixture(t)
	got, e := s.Load(context.Background(), hash(100))
	if e != nil || got.State != "unknown" || got.HeadNumber != "12" || got.JournalHeadNumber != "10" {
		t.Fatal(got, e)
	}
	r.lookup = &chainrpc.TransactionLookup{Hash: hash(100)}
	got, e = s.Load(context.Background(), hash(100))
	if e != nil || got.State != "pending" {
		t.Fatal(got, e)
	}
	included := receipt(12, true).Receipt
	r.receipt = &included
	r.lookup = &chainrpc.TransactionLookup{Hash: hash(100), BlockHash: &included.BlockHash, BlockNumber: &included.BlockNumber, TransactionIndex: &included.TransactionIndex}
	got, e = s.Load(context.Background(), hash(100))
	if e != nil || got.State != "confirmed" || got.Confirmations != "1" || got.Receipt.BlockNumber != "12" {
		t.Fatal(got, e)
	}
}
func TestServiceRejectsCrossSourceRaces(t *testing.T) {
	for _, mode := range []string{"chain", "genesis", "head", "journal", "lookup-error", "pending-receipt", "canonical", "missing-indexed-receipt", "different-receipt"} {
		t.Run(mode, func(t *testing.T) {
			s, j, r := serviceFixture(t)
			switch mode {
			case "chain":
				r.wrongChain = true
			case "genesis":
				r.wrongGenesis = true
			case "head":
				r.change = true
			case "journal":
				j.change = true
			case "lookup-error":
				r.fail = true
			case "pending-receipt":
				r.lookup = &chainrpc.TransactionLookup{Hash: hash(100)}
				v := receipt(9, true).Receipt
				r.receipt = &v
			case "canonical", "different-receipt":
				v := receipt(9, true).Receipt
				r.receipt = &v
				r.lookup = &chainrpc.TransactionLookup{Hash: hash(100), BlockHash: &v.BlockHash, BlockNumber: &v.BlockNumber, TransactionIndex: &v.TransactionIndex}
				if mode == "canonical" {
					r.wrongBlock = true
				} else {
					j.value.Receipt = &ReceiptStatus{"9", hash(9), "0", "reverted"}
				}
			case "missing-indexed-receipt":
				j.value.Receipt = &ReceiptStatus{"9", hash(9), "0", "succeeded"}
			}
			got, e := s.Load(context.Background(), hash(100))
			if e == nil || got.State != "" {
				t.Fatal(got, e)
			}
		})
	}
}
func TestServicePreservesOrphanHistory(t *testing.T) {
	s, j, r := serviceFixture(t)
	j.value.OrphanedReceipts = []ReceiptStatus{{"7", hash(77), "0", "succeeded"}}
	j.value.State = "reorged"
	got, e := s.Load(context.Background(), hash(100))
	if e != nil || got.State != "reorged" || len(got.OrphanedReceipts) != 1 {
		t.Fatal(got, e)
	}
	r.lookup = &chainrpc.TransactionLookup{Hash: hash(100)}
	got, e = s.Load(context.Background(), hash(100))
	if e != nil || got.State != "pending" || len(got.OrphanedReceipts) != 1 {
		t.Fatal(got, e)
	}
}
