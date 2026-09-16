package analytics

import (
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

func TestCommittedHolderTransfers(t *testing.T) {
	token, rs, ls := holderReceiptFixture()
	digest, err := chainrpc.ReceiptSetCommitment(rs)
	if err != nil {
		t.Fatal(err)
	}
	blocks := []CommittedReceiptBlock{{Number: "1", Hash: rs[0].BlockHash, ReceiptCount: 1, ReceiptSetHash: digest, Receipts: rs}}
	if _, err := DecodeCommittedHolderTransfers(4663, token, blocks, ls); err != nil {
		t.Fatal(err)
	}
	// Even deleting both the receipt and its filtered logs cannot pass the commitment.
	blocks[0].Receipts = []chainrpc.Receipt{}
	if _, err := DecodeCommittedHolderTransfers(4663, token, blocks, nil); err == nil {
		t.Fatal("last transaction omission accepted")
	}
	blocks[0].ReceiptCount = 0
	if _, err := DecodeCommittedHolderTransfers(4663, token, blocks, nil); err == nil {
		t.Fatal("altered count hid omission")
	}
	blocks[0].Receipts = rs
	blocks[0].ReceiptCount = 1
	blocks[0].ReceiptSetHash = ""
	if _, err := DecodeCommittedHolderTransfers(4663, token, blocks, ls); err == nil {
		t.Fatal("legacy uncommitted history accepted")
	}
}
