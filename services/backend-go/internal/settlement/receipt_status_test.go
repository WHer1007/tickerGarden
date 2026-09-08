package settlement

import (
	"errors"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

var (
	receiptJob       = "11" + strings.Repeat("11", 31)
	receiptTx        = "0x" + "22" + strings.Repeat("22", 31)
	receiptGen       = "0x" + "33" + strings.Repeat("33", 31)
	receiptHeadHash  = "0x" + "44" + strings.Repeat("44", 31)
	receiptFinalHash = "0x" + "55" + strings.Repeat("55", 31)
	receiptParent    = "0x" + "66" + strings.Repeat("66", 31)
)

func receiptHeader(number, timestamp, hash string) chainrpc.Header {
	return chainrpc.Header{Number: number, Timestamp: timestamp, Hash: hash, ParentHash: receiptParent}
}

func validReceiptObservation() ReceiptObservation {
	head := receiptHeader("0x64", "0x65f5b8c0", receiptHeadHash)
	finalized := receiptHeader("0x5a", "0x65f5b7a0", receiptFinalHash)
	return ReceiptObservation{ChainID: 4663, JobKey: receiptJob, TransactionHash: receiptTx, GenesisHash: receiptGen, Head: head, Finalized: finalized}
}

func receiptAt(number, hash, status string) *chainrpc.Receipt {
	return &chainrpc.Receipt{TransactionHash: receiptTx, TransactionIndex: "0x0", BlockHash: hash, BlockNumber: number, Status: status, Logs: []chainrpc.Log{}}
}

func TestReceiptStatus(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*ReceiptObservation)
		want    string
		wantErr bool
	}{
		{name: "nil receipt is not observed", want: "not_observed"},
		{name: "mined success", mutate: func(o *ReceiptObservation) { o.Receipt = receiptAt("0x5f", "0x"+strings.Repeat("77", 32), "0x1") }, want: "mined_success"},
		{name: "mined revert", mutate: func(o *ReceiptObservation) { o.Receipt = receiptAt("0x5f", "0x"+strings.Repeat("77", 32), "0x0") }, want: "mined_reverted"},
		{name: "finalized success", mutate: func(o *ReceiptObservation) { o.Receipt = receiptAt("0x5a", receiptFinalHash, "0x1") }, want: "finalized_success"},
		{name: "finalized revert", mutate: func(o *ReceiptObservation) { o.Receipt = receiptAt("0x5a", receiptFinalHash, "0x0") }, want: "finalized_reverted"},
		{name: "malformed header", mutate: func(o *ReceiptObservation) { o.Head.Number = "100" }, wantErr: true},
		{name: "malformed header hash", mutate: func(o *ReceiptObservation) { o.Head.Hash = "0x1234" }, wantErr: true},
		{name: "malformed observation hash", mutate: func(o *ReceiptObservation) { o.TransactionHash = "0x1234" }, wantErr: true},
		{name: "malformed receipt logs", mutate: func(o *ReceiptObservation) {
			o.Receipt = receiptAt("0x5f", "0x"+strings.Repeat("77", 32), "0x1")
			o.Receipt.Logs = nil
		}, wantErr: true},
		{name: "finalized above head", mutate: func(o *ReceiptObservation) { o.Finalized.Number = "0x65" }, wantErr: true},
		{name: "finalized time after head", mutate: func(o *ReceiptObservation) { o.Finalized.Timestamp = "0x65f5b8c1" }, wantErr: true},
		{name: "same height hash mismatch", mutate: func(o *ReceiptObservation) {
			o.Finalized.Number = o.Head.Number
			o.Finalized.Timestamp = o.Head.Timestamp
			o.Finalized.Hash = receiptFinalHash
		}, wantErr: true},
		{name: "receipt above head", mutate: func(o *ReceiptObservation) { o.Receipt = receiptAt("0x65", receiptHeadHash, "0x1") }, wantErr: true},
		{name: "receipt same height hash mismatch", mutate: func(o *ReceiptObservation) { o.Receipt = receiptAt("0x64", receiptFinalHash, "0x1") }, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			o := validReceiptObservation()
			if tt.mutate != nil {
				tt.mutate(&o)
			}
			got, err := receiptStatus(o)
			if tt.wantErr {
				if !errors.Is(err, ErrIntent) {
					t.Fatalf("receiptStatus() error = %v, want ErrIntent", err)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Fatalf("receiptStatus() = %q, %v; want %q, nil", got, err, tt.want)
			}
		})
	}
}
