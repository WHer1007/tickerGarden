package maintenance

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

type gasCostFixture struct {
	*receiptRPCFixture
	used, price     string
	mismatch, reorg bool
}

func (f gasCostFixture) TransactionGasReceipt(context.Context, string) (*chainrpc.GasReceipt, error) {
	r := &chainrpc.GasReceipt{Receipt: *f.receipt, GasUsed: f.used, EffectiveGasPrice: f.price}
	if f.mismatch {
		r.BlockHash = "0x" + strings.Repeat("1", 64)
	}
	if f.reorg {
		f.badBlock = true
	}
	return r, nil
}
func exerciseGasCosts(t *testing.T, ctx context.Context, store Store, pkey string) {
	t.Helper()
	in, e := store.Intent(ctx, pkey)
	if e != nil {
		t.Fatal(e)
	}
	signed, e := store.Signed(ctx, pkey)
	if e != nil {
		t.Fatal(e)
	}
	history, e := store.History(ctx, pkey, 0)
	if e != nil || len(history) == 0 {
		t.Fatal(e)
	}
	p := history[0].Preview
	before, e := store.GasBudget(ctx, p.GenesisHash, p.From)
	if e != nil {
		t.Fatal(e)
	}
	for _, mode := range []string{"success", "reverted", "pending", "missing", "over-gas", "over-price", "mismatch", "late-reorg"} {
		f := gasCostFixture{receiptRPCFixture: &receiptRPCFixture{p: p, finalized: true, receipt: &chainrpc.Receipt{TransactionHash: signed.TransactionHash, TransactionIndex: "0x0", BlockHash: p.BlockHash, BlockNumber: p.BlockNumber, Status: "0x1", Logs: []chainrpc.Log{}}}, used: "0x5208", price: "0x2"}
		switch mode {
		case "reverted":
			f.receipt.Status = "0x0"
		case "pending":
			f.finalized = false
		case "missing":
			f.used = ""
		case "over-gas":
			f.used = "0xffffff"
		case "over-price":
			f.price = "0xffff"
		case "mismatch":
			f.mismatch = true
		case "late-reorg":
			f.reorg = true
		}
		r, e := store.ObserveGasCost(ctx, f, pkey)
		if mode == "success" || mode == "reverted" {
			if e != nil || r.Cost.ExecutionGasCost != "42000" || r.Cost.MaximumGasCost != in.Intent.MaximumGasCost || r.Cost.TotalNativeFeeKnown {
				t.Fatal(mode, r, e)
			}
		} else if e == nil {
			t.Fatal("invalid gas evidence accepted", mode, r)
		}
	}
	records, e := store.GasCostHistory(ctx, pkey, 0)
	if e != nil || len(records) != 2 {
		t.Fatal(records, e)
	}
	page, e := store.GasCostHistory(ctx, pkey, records[0].Sequence)
	if e != nil || len(page) != 1 || page[0] != records[1] {
		t.Fatal(page, e)
	}
	after, e := store.GasBudget(ctx, p.GenesisHash, p.From)
	if e != nil || before != after {
		t.Fatal("gas observation changed budget", before, after, e)
	}
	body, _ := json.Marshal(records[0].Cost)
	if _, e = store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_gas_observations SET payload=$1 WHERE sequence=$2`, []byte("{}"), records[0].Sequence); e != nil {
		t.Fatal(e)
	}
	if _, e = store.GasCostHistory(ctx, pkey, 0); e == nil {
		t.Fatal("tampered gas history accepted")
	}
	if _, e = store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_gas_observations SET payload=$1 WHERE sequence=$2`, body, records[0].Sequence); e != nil {
		t.Fatal(e)
	}
}
