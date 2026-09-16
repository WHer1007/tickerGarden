package chainrpc

import (
	"context"
	"os"
	"testing"
	"time"
)

// Opt-in public RPC check. No transactions or signatures are submitted.
func TestReceiptRootLive(t *testing.T) {
	endpoint := os.Getenv("TG_TEST_RECEIPT_ROOT_RPC")
	if endpoint == "" {
		t.Skip("set TG_TEST_RECEIPT_ROOT_RPC for read-only RPC verification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	rpc, err := New(endpoint)
	if err != nil {
		t.Fatal("invalid RPC")
	}
	header, err := rpc.Header(ctx, "finalized")
	if err != nil {
		t.Fatal(err)
	}
	proof, err := rpc.VerifyReceiptRoot(ctx, header.Hash)
	if err != nil {
		t.Fatal(header.Number, header.Hash, err)
	}
	observation, err := (RootVerifiedClient{Client: rpc}).Observe(ctx, header)
	if err != nil {
		t.Fatal(err)
	}
	commitment, err := ReceiptSetCommitment(observation.Receipts)
	if err != nil || commitment != proof.ReceiptSetHash {
		t.Fatal("live observation commitment mismatch", err)
	}
	t.Logf("block=%s hash=%s receiptsRoot=%s receipts=%d", header.Number, proof.BlockHash, proof.ReceiptRoot, proof.ReceiptCount)
}
