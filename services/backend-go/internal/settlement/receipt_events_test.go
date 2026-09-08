package settlement

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
)

func eventWord(s string) string {
	s = strings.TrimPrefix(s, "0x")
	return strings.Repeat("0", 64-len(s)) + s
}
func matchingEvents(in IntentRecord, p ConversionPreview, o ReceiptObservation) ReceiptObservation {
	o.Status = "finalized_success"
	o.Finalized = o.Head
	logs := []chainrpc.Log{}
	b := p.Candidate.Plan.Batches[0]
	for i, item := range b.Items {
		logs = append(logs, chainrpc.Log{Address: in.Intent.Call.To, BlockHash: o.Head.Hash, BlockNumber: o.Head.Number, TransactionHash: o.TransactionHash, TransactionIndex: "0x0", LogIndex: fmt.Sprintf("0x%x", i), Topics: []string{itemEventTopic, b.MarketID, "0x" + eventWord(item.User), "0x" + eventWord(strconv.FormatUint(uint64(item.CreatorEpoch), 16))}, Data: "0x" + eventWord("1") + eventWord("64")})
	}
	n := len(b.Items)
	logs = append(logs, chainrpc.Log{Address: in.Intent.Call.To, BlockHash: o.Head.Hash, BlockNumber: o.Head.Number, TransactionHash: o.TransactionHash, TransactionIndex: "0x0", LogIndex: fmt.Sprintf("0x%x", n), Topics: []string{batchEventTopic, b.MarketID, "0x" + eventWord("1")}, Data: "0x" + eventWord(p.Candidate.State.MemeToken) + eventWord(p.Candidate.State.QuoteAsset) + eventWord(fmt.Sprintf("%x", n)) + eventWord(fmt.Sprintf("%x", n*100))})
	o.Receipt = &chainrpc.Receipt{TransactionHash: o.TransactionHash, TransactionIndex: "0x0", BlockHash: o.Head.Hash, BlockNumber: o.Head.Number, Status: "0x1", Logs: logs}
	return o
}

func receiptEventFixture(t *testing.T) (IntentRecord, ConversionPreview, ReceiptObservation) {
	t.Helper()
	r, _ := signedFixture(t)
	o := validReceiptObservation()
	r.Intent.JobKey = strings.Repeat("1", 64)
	o.JobKey = r.Intent.JobKey
	r.Intent.GenesisHash = o.GenesisHash
	b := Batch{MarketID: "0x" + strings.Repeat("a", 64), Items: []Item{{User: "0x" + strings.Repeat("4", 40), CreatorEpoch: 1, MaximumMeme: "5"}, {User: "0x" + strings.Repeat("5", 40), CreatorEpoch: 0, MaximumMeme: "7"}}, MinimumQuote: "99", Deadline: 100}
	data, err := conversionData(b)
	if err != nil {
		t.Fatal(err)
	}
	r.Intent.Call.Data = data
	p := ConversionPreview{To: r.Intent.Call.To, Candidate: ObservedCandidate{Plan: &Plan{Batches: []Batch{b}}, State: deployment.RewardConversionState{MemeToken: "0x" + strings.Repeat("3", 40), QuoteAsset: "0x" + strings.Repeat("2", 40)}}}
	o = matchingEvents(r, p, o)
	return r, p, o
}
func TestReceiptEventsMatchAndReject(t *testing.T) {
	r, p, o := receiptEventFixture(t)
	got, err := matchReceiptEvents(r, p, o)
	if err != nil || len(got.Items) != 2 || got.MemeSpent != "2" || got.QuoteReceived != "200" || got.Items[0].MaximumMeme != "5" {
		t.Fatal(got, err)
	}
	for _, mode := range []string{"not-finalized", "missing", "foreign-emitter", "wrong-user", "wrong-epoch", "order", "cap", "minimum", "sum", "asset", "duplicate", "data", "receipt-hash"} {
		t.Run(mode, func(t *testing.T) {
			r, p, o := receiptEventFixture(t)
			logs := o.Receipt.Logs
			switch mode {
			case "not-finalized":
				o.Finalized.Number = "0x1"
				o.Status = "mined_success"
			case "missing":
				o.Receipt.Logs = logs[:2]
			case "foreign-emitter":
				logs[0].Address = "0x" + strings.Repeat("f", 40)
			case "wrong-user":
				logs[0].Topics[2] = "0x" + eventWord("ff")
			case "wrong-epoch":
				logs[0].Topics[3] = "0x" + eventWord("2")
			case "order":
				logs[0].Topics[2], logs[1].Topics[2] = logs[1].Topics[2], logs[0].Topics[2]
			case "cap":
				logs[0].Data = "0x" + eventWord("6") + eventWord("64")
				logs[2].Data = "0x" + eventWord(p.Candidate.State.MemeToken) + eventWord(p.Candidate.State.QuoteAsset) + eventWord("7") + eventWord("c8")
			case "minimum":
				p.Candidate.Plan.Batches[0].MinimumQuote = "201"
				r.Intent.Call.Data, _ = conversionData(p.Candidate.Plan.Batches[0])
			case "sum":
				logs[2].Data = "0x" + eventWord(p.Candidate.State.MemeToken) + eventWord(p.Candidate.State.QuoteAsset) + eventWord("3") + eventWord("c8")
			case "asset":
				p.Candidate.State.MemeToken = "0x" + strings.Repeat("f", 40)
			case "duplicate":
				extra := logs[2]
				extra.LogIndex = "0x3"
				o.Receipt.Logs = append(logs, extra)
			case "data":
				r.Intent.Call.Data = "0x00"
			case "receipt-hash":
				logs[0].TransactionHash = "0x" + strings.Repeat("f", 64)
			}
			if _, err := matchReceiptEvents(r, p, o); err == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}
func TestIsolatedSettlementReceiptEvents(t *testing.T) {
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
	var proof, body []byte
	var seq int64
	if err = pool.QueryRow(ctx, `SELECT payload FROM tickergarden.settlement_checks WHERE sequence=$1`, in.Intent.CheckSequence).Scan(&proof); err != nil {
		t.Fatal(err)
	}
	var envelope struct{ Result checkedEnvelope }
	if json.Unmarshal(proof, &envelope) != nil {
		t.Fatal("proof")
	}
	if err = pool.QueryRow(ctx, `SELECT sequence,payload FROM tickergarden.settlement_receipt_observations WHERE job_key=$1 ORDER BY sequence LIMIT 1`, key).Scan(&seq, &body); err != nil {
		t.Fatal(err)
	}
	// Original synthetic contract deliberately has no protocol events: a success
	// receipt alone must never pass matching.
	if _, err = store.ReceiptEvents(ctx, scope, key, seq); err == nil {
		t.Fatal("accepted event-free receipt")
	}
	var o ReceiptObservation
	if json.Unmarshal(body, &o) != nil {
		t.Fatal("receipt")
	}
	o = matchingEvents(in, envelope.Result.Preview, o)
	synthetic, _ := json.Marshal(o)
	var added int64
	if err = pool.QueryRow(ctx, `INSERT INTO tickergarden.settlement_receipt_observations(job_key,payload,digest) VALUES($1,$2,$3) RETURNING sequence`, key, synthetic, receiptDigest(synthetic)).Scan(&added); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(context.Background(), `DELETE FROM tickergarden.settlement_receipt_observations WHERE sequence=$1`, added)
	got, err := store.ReceiptEvents(ctx, scope, key, added)
	if err != nil || got.ReceiptSequence != added || got.IntentDigest != in.Digest {
		t.Fatal(got, err)
	}
	foreign := scope
	foreign.Operator = "0x" + strings.Repeat("f", 40)
	if _, err = store.ReceiptEvents(ctx, foreign, key, added); err == nil {
		t.Fatal("cross sender")
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_receipt_observations SET payload=$2 WHERE sequence=$1`, added, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ReceiptEvents(ctx, scope, key, added); err == nil {
		t.Fatal("tampered receipt")
	}
}
