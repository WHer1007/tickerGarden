package transactions

import (
	"fmt"
	"reflect"
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

func hash(n int) string { return fmt.Sprintf("0x%064x", n) }
func observation() Observation {
	return Observation{ChainID: 4663, TransactionHash: hash(100), Head: Block{10, hash(10)}, Finalized: Block{8, hash(8)}, Receipts: []ObservedReceipt{}}
}
func receipt(height int, canonical bool) ObservedReceipt {
	return ObservedReceipt{chainrpc.Receipt{TransactionHash: hash(100), TransactionIndex: "0x0", BlockHash: hash(height), BlockNumber: fmt.Sprintf("0x%x", height), Status: "0x1", Logs: []chainrpc.Log{}}, canonical}
}
func TestTransactionStatesAndExecution(t *testing.T) {
	o := observation()
	check := func(state, confirmations string) {
		t.Helper()
		s, e := DeriveStatus(o)
		if e != nil || s.State != state || s.Confirmations != confirmations {
			t.Fatal(s, e)
		}
	}
	check("unknown", "0")
	o.PendingObserved = true
	check("pending", "0")
	o.PendingObserved = false
	o.Receipts = []ObservedReceipt{receipt(9, true)}
	check("confirmed", "2")
	o.Receipts[0] = receipt(8, true)
	check("finalized", "3")
	o.Receipts[0].Receipt.Status = "0x0"
	s, e := DeriveStatus(o)
	if e != nil || s.State != "finalized" || s.Receipt.Execution != "reverted" {
		t.Fatal(s, e)
	}
	o.Receipts = []ObservedReceipt{receipt(9, false)}
	check("reorged", "0")
	o.PendingObserved = true
	check("pending", "0")
	o.PendingObserved = false
	o.Receipts = append(o.Receipts, receipt(10, true))
	check("confirmed", "1")
	s, e = DeriveStatus(o)
	if e != nil || len(s.OrphanedReceipts) != 1 || s.Receipt.BlockHash != hash(10) {
		t.Fatal(s, e)
	}
}
func TestTransactionInconsistentEvidenceRejected(t *testing.T) {
	for _, mutate := range []func(*Observation){
		func(o *Observation) { o.ChainID = 1 }, func(o *Observation) { o.Receipts = nil }, func(o *Observation) { o.Head.Number = 7 }, func(o *Observation) { o.Finalized = Block{10, hash(11)} },
		func(o *Observation) { o.Receipts = []ObservedReceipt{receipt(11, true)} }, func(o *Observation) { o.PendingObserved = true; o.Receipts = []ObservedReceipt{receipt(9, true)} },
		func(o *Observation) { o.Receipts = []ObservedReceipt{receipt(9, true), receipt(10, true)} }, func(o *Observation) { o.Receipts = []ObservedReceipt{receipt(9, false), receipt(9, false)} },
		func(o *Observation) { o.Receipts = []ObservedReceipt{receipt(8, false)} }, func(o *Observation) {
			r := receipt(9, true)
			r.Receipt.TransactionHash = hash(999)
			o.Receipts = []ObservedReceipt{r}
		},
		func(o *Observation) {
			r := receipt(10, true)
			r.Receipt.BlockHash = hash(99)
			o.Receipts = []ObservedReceipt{r}
		}, func(o *Observation) { r := receipt(9, true); r.Receipt.Logs = nil; o.Receipts = []ObservedReceipt{r} },
	} {
		o := observation()
		mutate(&o)
		s, e := DeriveStatus(o)
		if e == nil || !reflect.DeepEqual(s, Status{}) {
			t.Fatal(s, e)
		}
	}
}
func TestTransactionOrphanHistoryDeterministic(t *testing.T) {
	o := observation()
	o.Receipts = []ObservedReceipt{receipt(7, false), receipt(6, false)}
	a, e := DeriveStatus(o)
	if e != nil {
		t.Fatal(e)
	}
	o.Receipts[0], o.Receipts[1] = o.Receipts[1], o.Receipts[0]
	b, e := DeriveStatus(o)
	if e != nil || !reflect.DeepEqual(a, b) || a.Receipt != nil {
		t.Fatal(a, b, e)
	}
}
