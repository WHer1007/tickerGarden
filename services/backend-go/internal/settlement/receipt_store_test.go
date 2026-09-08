package settlement

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/postgres"
	"time"
)

type receiptFixture struct {
	o     ReceiptObservation
	mode  string
	reads int
}

func (f *receiptFixture) ChainID(context.Context) (uint64, error) {
	if f.mode == "chain" {
		return 1, nil
	}
	return f.o.ChainID, nil
}
func (f *receiptFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	h := f.o.Head
	switch tag {
	case "0x0":
		h.Number = "0x0"
		h.Hash = f.o.GenesisHash
	case "finalized":
		h = f.o.Finalized
	case "latest":
	default:
		if tag == f.o.Finalized.Number {
			h = f.o.Finalized
		}
		if tag == f.o.Head.Number {
			h = f.o.Head
			f.reads++
		}
	}
	if (f.mode == "block" || (f.mode == "late-reorg" && f.reads > 1)) && tag == f.o.Head.Number {
		h.Hash = "0x" + strings.Repeat("9", 64)
	}
	if f.mode == "genesis" && tag == "0x0" {
		h.Hash = "0x" + strings.Repeat("9", 64)
	}
	return h, nil
}
func (f *receiptFixture) TransactionReceipt(context.Context, string) (*chainrpc.Receipt, error) {
	return f.o.Receipt, nil
}
func (f *receiptFixture) Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error) {
	if f.mode == "observe" {
		return chainrpc.Observation{}, errors.New("missing receipt")
	}
	if f.mode == "missing" {
		return chainrpc.Observation{}, nil
	}
	r := *f.o.Receipt
	if f.mode == "mismatch" {
		r.Status = "0x0"
	}
	out := chainrpc.Observation{Receipts: []chainrpc.Receipt{r}}
	if f.mode == "duplicate" {
		out.Receipts = append(out.Receipts, r)
	}
	return out, nil
}
func TestIsolatedSettlementReceipt(t *testing.T) {
	dsn := os.Getenv("TG_SETTLEMENT_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated receipt database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p, err := postgres.Open(ctx, dsn, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	var body []byte
	if err = p.QueryRow(ctx, `SELECT payload FROM tickergarden.settlement_receipt_observations ORDER BY sequence LIMIT 1`).Scan(&body); err != nil {
		t.Fatal(err)
	}
	var seed ReceiptObservation
	if json.Unmarshal(body, &seed) != nil {
		t.Fatal("invalid seed")
	}
	var sender string
	if err = p.QueryRow(ctx, `SELECT sender FROM tickergarden.settlement_intents WHERE job_key=$1`, seed.JobKey).Scan(&sender); err != nil {
		t.Fatal(err)
	}
	scope := WorkScope{ChainID: seed.ChainID, GenesisHash: seed.GenesisHash, Operator: sender}
	store := Store{Pool: p, ChainID: scope.ChainID}
	// Controlled fresh headers keep state-machine tests independent of wall-clock
	// advancement and Anvil's finalized-tag policy. They are not chain evidence.
	seed.Head.Timestamp = "0x" + strconv.FormatInt(time.Now().Unix(), 16)
	seed.Head.Number = seed.Receipt.BlockNumber
	seed.Head.Hash = seed.Receipt.BlockHash
	seed.Finalized = seed.Head
	base, err := store.ReceiptHistory(ctx, scope, seed.JobKey, 0)
	if err != nil || len(base) != 1 {
		t.Fatal(base, err)
	}
	for _, mode := range []string{"chain", "genesis", "block", "late-reorg", "observe", "missing", "mismatch", "duplicate", "stale"} {
		f := &receiptFixture{o: seed, mode: mode}
		if mode == "stale" {
			f.o.Head.Timestamp = "0x" + strconv.FormatInt(time.Now().Unix()-200, 16)
			f.o.Finalized = f.o.Head
		}
		if _, err = store.ObserveReceipt(ctx, f, scope, seed.JobKey); err == nil {
			t.Fatal("accepted", mode)
		}
	}
	unchanged, err := store.ReceiptHistory(ctx, scope, seed.JobKey, 0)
	if err != nil || len(unchanged) != 1 {
		t.Fatal("failed observation appended", err)
	}
	for _, status := range []string{"not_observed", "mined_success", "finalized_success", "finalized_reverted"} {
		f := &receiptFixture{o: seed}
		r := *seed.Receipt
		f.o.Receipt = &r
		if status == "not_observed" {
			f.o.Receipt = nil
		}
		if status == "mined_success" {
			height, _ := seed.Head.Height()
			f.o.Finalized.Number = "0x" + strconv.FormatUint(height-1, 16)
			f.o.Finalized.Hash = "0x" + strings.Repeat("8", 64)
		}
		if status == "finalized_reverted" {
			r.Status = "0x0"
			r.Logs = []chainrpc.Log{}
		}
		got, e := store.ObserveReceipt(ctx, f, scope, seed.JobKey)
		if e != nil || got.Observation.Status != status {
			t.Fatal(status, got, e)
		}
	}
	history, err := store.ReceiptHistory(ctx, scope, seed.JobKey, base[0].Sequence)
	if err != nil || len(history) != 4 {
		t.Fatal(history, err)
	}
	foreign := scope
	foreign.Operator = "0x" + strings.Repeat("f", 40)
	if _, err = store.ReceiptHistory(ctx, foreign, seed.JobKey, 0); err == nil {
		t.Fatal("foreign receipt read")
	}
	seq := base[0].Sequence
	defer p.Exec(context.Background(), `UPDATE tickergarden.settlement_receipt_observations SET payload=$2 WHERE sequence=$1`, seq, body)
	if _, err = p.Exec(ctx, `UPDATE tickergarden.settlement_receipt_observations SET payload=$2 WHERE sequence=$1`, seq, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ReceiptHistory(ctx, scope, seed.JobKey, 0); err == nil {
		t.Fatal("tampered history accepted")
	}
}
