package settlement

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestMatchTraceRoot(t *testing.T) {
	in, p, o := receiptEventFixture(t)
	m, err := matchReceiptEvents(in, p, o)
	if err != nil {
		t.Fatal(err)
	}
	valid := chainrpc.CallTrace{Type: "CALL", From: in.Intent.Call.From, To: in.Intent.Call.To, Input: in.Intent.Call.Data, Value: in.Intent.Call.Value, Output: "0x" + eventWord("2") + eventWord("c8")}
	if matchTraceRoot(in, m, valid) != nil {
		t.Fatal("valid trace rejected")
	}
	for _, mode := range []string{"from", "to", "input", "value", "output", "error", "type"} {
		tr := valid
		switch mode {
		case "from":
			tr.From = "0x00"
		case "to":
			tr.To = "0x00"
		case "input":
			tr.Input = "0x"
		case "value":
			tr.Value = "0x1"
		case "output":
			tr.Output = "0x" + eventWord("3") + eventWord("c8")
		case "error":
			tr.Error = "reverted"
		case "type":
			tr.Type = "DELEGATECALL"
		}
		if matchTraceRoot(in, m, tr) == nil {
			t.Fatal("accepted", mode)
		}
	}
}

type traceReceiptFixture struct {
	*receiptFixture
	trace chainrpc.CallTrace
	reorg bool
}

func (f *traceReceiptFixture) TransactionCallTrace(context.Context, string) (chainrpc.CallTrace, error) {
	if f.reorg {
		f.mode = "late-reorg"
	}
	return f.trace, nil
}
func TestIsolatedSettlementReceiptTrace(t *testing.T) {
	dsn := os.Getenv("TG_SETTLEMENT_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var scope WorkScope
	var key string
	if err = pool.QueryRow(ctx, `SELECT chain_id,genesis_hash,sender,job_key FROM tickergarden.settlement_intents ORDER BY created_at LIMIT 1`).Scan(&scope.ChainID, &scope.GenesisHash, &scope.Operator, &key); err != nil {
		t.Fatal(err)
	}
	store := Store{Pool: pool, ChainID: scope.ChainID}
	in, err := store.Intent(ctx, scope, key)
	if err != nil {
		t.Fatal(err)
	}
	var raw, body []byte
	if err = pool.QueryRow(ctx, `SELECT payload FROM tickergarden.settlement_checks WHERE sequence=$1`, in.Intent.CheckSequence).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var envelope struct{ Result checkedEnvelope }
	if json.Unmarshal(raw, &envelope) != nil {
		t.Fatal("proof")
	}
	if err = pool.QueryRow(ctx, `SELECT payload FROM tickergarden.settlement_receipt_observations WHERE job_key=$1 ORDER BY sequence LIMIT 1`, key).Scan(&body); err != nil {
		t.Fatal(err)
	}
	var o ReceiptObservation
	if json.Unmarshal(body, &o) != nil {
		t.Fatal("receipt")
	}
	o.Head.Timestamp = "0x" + strconv.FormatInt(time.Now().Unix(), 16)
	o = matchingEvents(in, envelope.Result.Preview, o)
	n := len(envelope.Result.Preview.Candidate.Plan.Batches[0].Items)
	root := chainrpc.CallTrace{Type: "CALL", From: in.Intent.Call.From, To: in.Intent.Call.To, Input: in.Intent.Call.Data, Value: in.Intent.Call.Value, Output: "0x" + eventWord(fmt.Sprintf("%x", n)) + eventWord(fmt.Sprintf("%x", n*100))}
	b := envelope.Result.Preview.Candidate.Plan.Batches[0]

	creators := 0
	for _, item := range b.Items {
		if item.CreatorEpoch != 0 {
			creators++
			continue
		}
		max, _ := amount(item.MaximumMeme)
		root.Calls = append(root.Calls, chainrpc.CallTrace{Type: "CALL", From: in.Intent.Call.To, To: envelope.Result.Preview.Candidate.State.Gauge, Value: "0x0", Input: traceSelector("consumeForConversion(address,uint256)") + eventWord(item.User) + eventWord(max.Text(16)), Output: "0x" + eventWord("1")})
	}
	root.Calls = append(root.Calls, chainrpc.CallTrace{Type: "CALL", From: in.Intent.Call.To, To: envelope.Result.Preview.Route.Hook, Value: "0x0", Input: traceSelector("convertRewards(bytes32,uint256,uint256,uint256)") + eventWord(b.MarketID) + eventWord(fmt.Sprintf("%x", n)) + eventWord(func() string { v, _ := amount(b.MinimumQuote); return v.Text(16) }()) + eventWord(strconv.FormatInt(b.Deadline, 16)), Output: root.Output})
	for _, item := range b.Items {
		if item.CreatorEpoch != 0 {
			continue
		}
		root.Calls = append(root.Calls, chainrpc.CallTrace{Type: "CALL", From: in.Intent.Call.To, To: envelope.Result.Preview.Candidate.State.Gauge, Value: "0x0", Input: traceSelector("creditConversion(address,uint256,uint256)") + eventWord(item.User) + eventWord("0") + eventWord("64"), Output: "0x"})
	}
	f := &traceReceiptFixture{receiptFixture: &receiptFixture{o: o}, trace: root}
	got, err := store.TraceReceipt(ctx, f, scope, key)
	if err != nil || got.Events.IntentDigest != in.Digest {
		t.Fatal(got, err)
	}
	f = &traceReceiptFixture{receiptFixture: &receiptFixture{o: o}, trace: root}
	accounting, err := store.TraceAccounting(ctx, f, scope, key)
	if err != nil || accounting.Accounting.AllInputsObserved != (creators == 0) || len(accounting.Accounting.UnresolvedCreators) != creators {
		t.Fatal(accounting, err)
	}
	f = &traceReceiptFixture{receiptFixture: &receiptFixture{o: o}, trace: root, reorg: true}
	if _, err = store.TraceReceipt(ctx, f, scope, key); err == nil {
		t.Fatal("late reorg accepted")
	}
	f = &traceReceiptFixture{receiptFixture: &receiptFixture{o: o}, trace: root}
	f.trace.Output = "0x"
	if _, err = store.TraceReceipt(ctx, f, scope, key); err == nil {
		t.Fatal("wrong output accepted")
	}
}

func TestRecheckTraceReceiptAfterFollowup(t *testing.T) {
	for _, mode := range []string{"valid", "late-reorg", "stale", "changed-receipt"} {
		t.Run(mode, func(t *testing.T) {
			o := validReceiptObservation()
			o.Head.Timestamp = "0x" + strconv.FormatInt(time.Now().Unix(), 16)
			if mode == "stale" {
				o.Head.Timestamp = "0x" + strconv.FormatInt(time.Now().Unix()-121, 16)
			}
			o.Finalized = o.Head
			o.Receipt = receiptAt(o.Head.Number, o.Head.Hash, "0x1")
			f := &receiptFixture{o: o}
			if mode == "late-reorg" {
				f.mode = mode
				f.reads = 2
			}
			if mode == "changed-receipt" {
				r := *o.Receipt
				r.Status = "0x0"
				f.o.Receipt = &r
			}
			err := recheckTraceReceipt(context.Background(), f, ReceiptRecord{Observation: o}, o.TransactionHash)
			if (err == nil) != (mode == "valid") {
				t.Fatal(mode, err)
			}
		})
	}
}
