package treasury

import "testing"

func TestHistoryBudgetUnrelatedReceiptsDoNotConsumeRetainedBudget(t *testing.T) {
	b := historyBudget{}
	const receiptSize = MaxHistoryPayloadBytes

	// Stream more than the retained payload budget while retaining nothing.
	for i := 0; i < 2; i++ {
		if err := b.receipt(receiptSize); err != nil {
			t.Fatalf("receipt %d: %v", i, err)
		}
	}
	if b.scanned != uint64(2*receiptSize) {
		t.Fatalf("scanned = %d, want %d", b.scanned, 2*receiptSize)
	}
	if b.retained != 0 {
		t.Fatalf("retained = %d, want 0", b.retained)
	}
}

func TestHistoryBudgetReceiptScanBoundary(t *testing.T) {
	b := historyBudget{}
	const chunk = MaxHistoryPayloadBytes
	const chunks = MaxHistoryReceiptScanBytes / uint64(chunk)

	for i := uint64(0); i < chunks; i++ {
		if err := b.receipt(chunk); err != nil {
			t.Fatalf("receipt %d: %v", i, err)
		}
	}
	if b.scanned != MaxHistoryReceiptScanBytes {
		t.Fatalf("scanned = %d, want %d", b.scanned, MaxHistoryReceiptScanBytes)
	}
	if err := b.receipt(1); err == nil {
		t.Fatal("receipt beyond scan boundary succeeded")
	}
	if b.scanned != MaxHistoryReceiptScanBytes {
		t.Fatalf("failed receipt changed scanned to %d", b.scanned)
	}
}

func TestHistoryBudgetIndividualReceiptBoundary(t *testing.T) {
	b := historyBudget{}
	if err := b.receipt(MaxHistoryPayloadBytes); err != nil {
		t.Fatalf("maximum receipt: %v", err)
	}
	scanned := b.scanned
	if err := b.receipt(MaxHistoryPayloadBytes + 1); err == nil {
		t.Fatal("oversized receipt succeeded")
	}
	if b.scanned != scanned {
		t.Fatalf("failed receipt changed scanned to %d", b.scanned)
	}
}

func TestHistoryBudgetRetainedBoundary(t *testing.T) {
	b := historyBudget{}
	if err := b.retain(MaxHistoryPayloadBytes); err != nil {
		t.Fatalf("maximum retained payload: %v", err)
	}
	retained := b.retained
	if err := b.retain(1); err == nil {
		t.Fatal("retained payload beyond boundary succeeded")
	}
	if b.retained != retained {
		t.Fatalf("failed retain changed retained to %d", b.retained)
	}
}

func TestHistoryBudgetRejectsNegativeSizesWithoutMutation(t *testing.T) {
	tests := []struct {
		name string
		call func(*historyBudget) error
	}{
		{name: "receipt", call: func(b *historyBudget) error { return b.receipt(-1) }},
		{name: "retain", call: func(b *historyBudget) error { return b.retain(-1) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := historyBudget{scanned: 7, retained: 11}
			if err := tt.call(&b); err == nil {
				t.Fatal("negative size succeeded")
			}
			if b.scanned != 7 || b.retained != 11 {
				t.Fatalf("failed operation changed counters: scanned=%d retained=%d", b.scanned, b.retained)
			}
		})
	}
}
