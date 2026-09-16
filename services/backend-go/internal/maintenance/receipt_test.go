package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type receiptRPCFixture struct {
	p          deployment.MaintenancePreview
	receipt    *chainrpc.Receipt
	finalized  bool
	wrongChain bool
	badBlock   bool
	badObserve bool
	lateReorg  bool
	reads      int
}

func (f *receiptRPCFixture) ChainID(context.Context) (uint64, error) {
	if f.wrongChain {
		return 1, nil
	}
	return f.p.ChainID, nil
}
func (f *receiptRPCFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	h := chainrpc.Header{Number: f.p.BlockNumber, Hash: f.p.BlockHash, ParentHash: f.p.GenesisHash, Timestamp: f.p.BlockTimestamp}
	if tag == "0x0" {
		h.Number = "0x0"
		h.Hash = f.p.GenesisHash
		return h, nil
	}
	if tag == "finalized" && !f.finalized {
		height, _ := h.Height()
		h.Number = "0x" + strconv.FormatUint(height-1, 16)
		h.Hash = "0x" + strings.Repeat("8", 64)
	}
	if tag != "latest" && tag != "finalized" && tag != f.p.BlockNumber {
		h.Number = tag
		h.Hash = "0x" + strings.Repeat("8", 64)
	}
	if tag == f.p.BlockNumber {
		f.reads++
		if f.badBlock || (f.lateReorg && f.reads > 1) {
			h.Hash = "0x" + strings.Repeat("9", 64)
		}
	}
	return h, nil
}
func (f *receiptRPCFixture) TransactionReceipt(context.Context, string) (*chainrpc.Receipt, error) {
	return f.receipt, nil
}
func (f *receiptRPCFixture) Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error) {
	if f.badObserve {
		return chainrpc.Observation{}, errors.New("truncated block")
	}
	if f.receipt == nil {
		return chainrpc.Observation{}, nil
	}
	return chainrpc.Observation{Receipts: []chainrpc.Receipt{*f.receipt}}, nil
}

// Called by the isolated submission suite once signed material and the outbox
// exist. No live external chain or production sender is used.
func exerciseReceiptRecovery(t *testing.T, ctx context.Context, store Store, p deployment.MaintenancePreview, signed SignedTransaction) {
	t.Helper()
	f := &receiptRPCFixture{p: p}
	for _, status := range []string{"not_observed", "mined_success", "finalized_success", "finalized_reverted", "not_observed"} {
		f.receipt = nil
		f.finalized = false
		f.reads = 0
		if status != "not_observed" {
			rstatus := "0x1"
			if status == "finalized_reverted" {
				rstatus = "0x0"
			}
			f.receipt = &chainrpc.Receipt{TransactionHash: signed.TransactionHash, TransactionIndex: "0x0", BlockHash: p.BlockHash, BlockNumber: p.BlockNumber, Status: rstatus, Logs: []chainrpc.Log{}}
			f.finalized = strings.HasPrefix(status, "finalized")
		}
		got, e := store.ObserveReceipt(ctx, f, p.Key)
		if e != nil || got.Observation.Status != status {
			t.Fatalf("observation %s: %#v %v", status, got, e)
		}
	}
	history, e := store.ReceiptHistory(ctx, p.Key, 0)
	if e != nil || len(history) != 5 {
		t.Fatalf("history: %d %v", len(history), e)
	}
	page, e := store.ReceiptHistory(ctx, p.Key, history[3].Sequence)
	if e != nil || len(page) != 1 || page[0].Observation.Status != "not_observed" {
		t.Fatalf("page: %#v %v", page, e)
	}
	for _, mode := range []string{"chain", "block", "observe", "late-reorg", "stale"} {
		f = &receiptRPCFixture{p: p, receipt: &chainrpc.Receipt{TransactionHash: signed.TransactionHash, TransactionIndex: "0x0", BlockHash: p.BlockHash, BlockNumber: p.BlockNumber, Status: "0x1", Logs: []chainrpc.Log{}}}
		switch mode {
		case "chain":
			f.wrongChain = true
		case "block":
			f.badBlock = true
		case "observe":
			f.badObserve = true
		case "late-reorg":
			f.lateReorg = true
		case "stale":
			f.p.BlockTimestamp = "0x" + strconv.FormatInt(time.Now().Unix()-200, 16)
		}
		if _, e = store.ObserveReceipt(ctx, f, p.Key); e == nil {
			t.Fatalf("accepted %s", mode)
		}
	}
	after, e := store.ReceiptHistory(ctx, p.Key, 0)
	if e != nil || len(after) != 5 {
		t.Fatal("failed observation persisted", e)
	}
	original, _ := json.Marshal(history[0].Observation)
	defer store.Pool.Exec(context.Background(), `UPDATE tickergarden.maintenance_receipt_observations SET payload=$1 WHERE sequence=$2`, original, history[0].Sequence)
	if _, e = store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_receipt_observations SET payload=$1 WHERE sequence=$2`, []byte("{}"), history[0].Sequence); e != nil {
		t.Fatal(e)
	}
	if _, e = store.ReceiptHistory(ctx, p.Key, 0); e == nil {
		t.Fatal("corrupt receipt history accepted")
	}
}
