package analytics

import (
	"fmt"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
)

func holderReceiptFixture() (string, []chainrpc.Receipt, []chainrpc.Log) {
	token := fmt.Sprintf("0x%040x", 1)
	l := chainrpc.Log{Address: token, BlockNumber: "0x1", BlockHash: fmt.Sprintf("0x%064x", 1), TransactionHash: fmt.Sprintf("0x%064x", 2), TransactionIndex: "0x0", LogIndex: "0x0", Topics: []string{crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)")).Hex(), fmt.Sprintf("0x%064x", 0), fmt.Sprintf("0x%064x", 2)}, Data: fmt.Sprintf("0x%064x", 1000)}
	r := chainrpc.Receipt{BlockNumber: l.BlockNumber, BlockHash: l.BlockHash, TransactionHash: l.TransactionHash, TransactionIndex: l.TransactionIndex, Status: "0x1", Logs: []chainrpc.Log{l}}
	return token, []chainrpc.Receipt{r}, []chainrpc.Log{l}
}
func TestHolderReceiptReplay(t *testing.T) {
	token, rs, ls := holderReceiptFixture()
	got, err := DecodeHolderTransfers(4663, token, rs, ls)
	if err != nil || len(got) != 1 || got[0].Value != "1000" {
		t.Fatal(got, err)
	}
	out, err := RebuildHolderBalances(4663, token, fmt.Sprintf("0x%040x", 2), fmt.Sprintf("0x%040x", 3), "1000", got, nil)
	if err != nil || out.TotalSupplyRaw != "1000" || out.PositiveAddressCount != 1 {
		t.Fatal(out, err)
	}
}
func TestHolderReceiptMismatch(t *testing.T) {
	cases := map[string]func([]chainrpc.Receipt, []chainrpc.Log) ([]chainrpc.Receipt, []chainrpc.Log){
		"deleted journal": func(r []chainrpc.Receipt, l []chainrpc.Log) ([]chainrpc.Receipt, []chainrpc.Log) { return r, nil },
		"deleted receipt": func(r []chainrpc.Receipt, l []chainrpc.Log) ([]chainrpc.Receipt, []chainrpc.Log) { return nil, l },
		"duplicate journal": func(r []chainrpc.Receipt, l []chainrpc.Log) ([]chainrpc.Receipt, []chainrpc.Log) {
			return r, append(l, l[0])
		},
		"duplicate receipt": func(r []chainrpc.Receipt, l []chainrpc.Log) ([]chainrpc.Receipt, []chainrpc.Log) {
			return append(r, r[0]), l
		},
		"failed with logs": func(r []chainrpc.Receipt, l []chainrpc.Log) ([]chainrpc.Receipt, []chainrpc.Log) {
			r[0].Status = "0x0"
			return r, l
		},
		"missing transaction": func(r []chainrpc.Receipt, l []chainrpc.Log) ([]chainrpc.Receipt, []chainrpc.Log) {
			r[0].TransactionIndex = "0x1"
			return r, l
		},
		"tampered amount": func(r []chainrpc.Receipt, l []chainrpc.Log) ([]chainrpc.Receipt, []chainrpc.Log) {
			l[0].Data = fmt.Sprintf("0x%064x", 999)
			return r, l
		},
		"removed log": func(r []chainrpc.Receipt, l []chainrpc.Log) ([]chainrpc.Receipt, []chainrpc.Log) {
			r[0].Logs[0].Removed = true
			return r, l
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			token, r, l := holderReceiptFixture()
			r, l = mutate(r, l)
			if _, err := DecodeHolderTransfers(4663, token, r, l); err == nil {
				t.Fatal("accepted incomplete or conflicting receipts")
			}
		})
	}
}
