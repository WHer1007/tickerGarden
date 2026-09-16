package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/transactions"
	"time"
)

type transactionFixture struct {
	calls int
	err   error
	bad   bool
}

func (f *transactionFixture) Load(ctx context.Context, hash string) (transactions.CombinedStatus, error) {
	f.calls++
	if _, ok := ctx.Deadline(); !ok {
		panic("missing deadline")
	}
	out := transactions.CombinedStatus{Status: transactions.Status{ChainID: 4663, TransactionHash: hash, State: "pending", Confirmations: "0", OrphanedReceipts: []transactions.ReceiptStatus{}, HeadNumber: "1", HeadHash: "0x" + strings.Repeat("1", 64), FinalizedNumber: "0", FinalizedHash: "0x" + strings.Repeat("0", 64)}, Source: "indexed_journal_and_rpc", IndexedFrom: "0", JournalHeadNumber: "1", JournalHeadHash: "0x" + strings.Repeat("1", 64), JournalObservedAt: time.Now(), RPCObservedAt: time.Now()}
	if f.bad {
		out.State = "invented"
	}
	return out, f.err
}
func TestTransactionHTTP(t *testing.T) {
	f := &transactionFixture{}
	h := New(Options{ChainID: 4663, Transactions: f})
	path := "/v1/transactions/0x" + strings.Repeat("2", 64)
	for _, suffix := range []string{"?foo=1", "?revision=1", "?%zz"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path+suffix, nil))
		if w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid query reached service")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Body.String(), `"state":"pending"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, bad := range []bool{false, true} {
		f.bad = bad
		if !bad {
			f.err = errors.New("private RPC failure")
		} else {
			f.err = nil
		}
		w = httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 503 || strings.Contains(w.Body.String(), "private") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	w = httptest.NewRecorder()
	New(Options{}).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", path, nil))
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
}
