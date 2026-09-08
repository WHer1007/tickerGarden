package chainrpc

import "testing"

func TestReceiptSetCommitment(t *testing.T) {
	a := Receipt{TransactionHash: "first", Logs: []Log{}}
	b := Receipt{TransactionHash: "second", Logs: []Log{}}
	original, e := ReceiptSetCommitment([]Receipt{a, b})
	if e != nil {
		t.Fatal(e)
	}
	for _, set := range [][]Receipt{{a}, {b, a}, {a, a}, {}} {
		got, e := ReceiptSetCommitment(set)
		if e != nil || got == original {
			t.Fatal("missing/reordered/replaced receipts not detected", got, e)
		}
	}
	mutated := b
	mutated.Status = "0x0"
	got, e := ReceiptSetCommitment([]Receipt{a, mutated})
	if e != nil || got == original {
		t.Fatal("mutation not detected")
	}
	again, e := ReceiptSetCommitment([]Receipt{a, b})
	if e != nil || again != original {
		t.Fatal("nondeterministic commitment")
	}
	if _, e := ReceiptSetCommitment(nil); e == nil {
		t.Fatal("nil receipt observation accepted")
	}
}
