package settlement

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"tickergarden/backend/internal/postgres"
	"time"
)

// Exercise migration 62 and receipt binding in a rollback-only transaction.
// This does not substitute for recording real protocol execution via RPC.
func TestIsolatedSettlementReceiptEvidenceStorage(t *testing.T) {
	dsn := os.Getenv("TG_SETTLEMENT_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 2)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	tx, e := pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	var key, digest string
	var seq int64
	var raw []byte
	e = tx.QueryRow(ctx, `SELECT r.job_key,r.sequence,r.payload,r.digest FROM tickergarden.settlement_receipt_observations r JOIN tickergarden.settlement_submissions s ON s.job_key=r.job_key ORDER BY r.sequence LIMIT 1`).Scan(&key, &seq, &raw, &digest)
	if e != nil {
		t.Fatal(e)
	}
	var scope WorkScope
	if tx.QueryRow(ctx, `SELECT chain_id,genesis_hash,operator FROM tickergarden.settlement_work WHERE job_key=$1`, key).Scan(&scope.ChainID, &scope.GenesisHash, &scope.Operator) != nil {
		t.Fatal("scope")
	}
	store := Store{Pool: pool, ChainID: scope.ChainID}
	// Exercise the public historical API over real stored intent, signature and
	// submission material. SELECT FOR UPDATE would fail in its read-only tx.
	history, err := store.ExecutionEvidenceHistory(ctx, scope, key, 0)
	if err != nil || len(history) != 0 {
		t.Fatal("read-only historical material", history, err)
	}
	wrong := scope
	wrong.Operator = "0x0000000000000000000000000000000000000001"
	if _, err = store.ExecutionEvidenceHistory(ctx, wrong, key, 0); err == nil {
		t.Fatal("wrong operator accepted")
	}
	if _, err = store.ExecutionEvidence(ctx, scope, key, 1); err == nil {
		t.Fatal("missing record accepted")
	}
	var o ReceiptObservation
	if json.Unmarshal(raw, &o) != nil {
		t.Fatal("receipt")
	}
	_, _, ev := executionFixture(t)
	ev.Evidence.Evidence.Evidence.Evidence.Receipt = ReceiptRecord{Sequence: seq, Digest: digest, Observation: o}
	if checkEvidenceReceipt(ctx, tx, key, o.TransactionHash, ev) != nil {
		t.Fatal("receipt binding")
	}
	if checkEvidenceReceipt(ctx, tx, key, "0x00", ev) == nil {
		t.Fatal("wrong transaction accepted")
	}
	payload, e := json.Marshal(ev)
	if e != nil {
		t.Fatal(e)
	}
	var storedSeq int64
	e = tx.QueryRow(ctx, `INSERT INTO tickergarden.settlement_execution_evidence(job_key,receipt_sequence,intent_digest,payload,digest) SELECT $1,$2,digest,$3,$4 FROM tickergarden.settlement_intents WHERE job_key=$1 RETURNING sequence`, key, seq, payload, receiptDigest(payload)).Scan(&storedSeq)
	if e != nil {
		t.Fatal(e)
	}
	var restored []byte
	var storedDigest string
	if tx.QueryRow(ctx, `SELECT payload,digest FROM tickergarden.settlement_execution_evidence WHERE sequence=$1 AND job_key=$2`, storedSeq, key).Scan(&restored, &storedDigest) != nil || !reflect.DeepEqual(restored, payload) || receiptDigest(restored) != storedDigest {
		t.Fatal("storage round trip")
	}
	var decoded ReceiptGaugeStorage
	if json.Unmarshal(restored, &decoded) != nil || !reflect.DeepEqual(decoded, ev) {
		t.Fatal("typed round trip")
	}
	for _, bad := range []string{"duplicate", "empty", "digest", "receipt"} {
		if _, e = tx.Exec(ctx, "SAVEPOINT evidence_constraint"); e != nil {
			t.Fatal(e)
		}
		switch bad {
		case "duplicate":
			_, e = tx.Exec(ctx, `INSERT INTO tickergarden.settlement_execution_evidence(job_key,receipt_sequence,intent_digest,payload,digest) SELECT job_key,receipt_sequence,intent_digest,payload,digest FROM tickergarden.settlement_execution_evidence WHERE sequence=$1`, storedSeq)
		case "empty":
			_, e = tx.Exec(ctx, `UPDATE tickergarden.settlement_execution_evidence SET payload=''::bytea WHERE sequence=$1`, storedSeq)
		case "digest":
			_, e = tx.Exec(ctx, `UPDATE tickergarden.settlement_execution_evidence SET digest='bad' WHERE sequence=$1`, storedSeq)
		case "receipt":
			_, e = tx.Exec(ctx, `UPDATE tickergarden.settlement_execution_evidence SET receipt_sequence=-1 WHERE sequence=$1`, storedSeq)
		}
		if e == nil {
			t.Fatal("accepted", bad)
		}
		if _, e = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT evidence_constraint"); e != nil {
			t.Fatal(e)
		}
	}
}
