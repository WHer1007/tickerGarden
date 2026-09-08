package settlement

import (
	"context"
	"encoding/json"
	"reflect"
	"time"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
)

const executionEvidenceLimit = 8 << 20

type ExecutionEvidenceRecord struct {
	Sequence int64               `json:"sequence"`
	Digest   string              `json:"digest"`
	Evidence ReceiptGaugeStorage `json:"evidence"`
}
type ExecutionEvidenceSummary struct {
	Sequence        int64           `json:"sequence"`
	Digest          string          `json:"digest"`
	ReceiptSequence int64           `json:"receiptSequence"`
	TransactionHash string          `json:"transactionHash"`
	Block           chainrpc.Header `json:"block"`
}

// replayExecutionEvidence verifies derived results from original signed input
// and retained observations. Historical replay does not assert current finality.
func replayExecutionEvidence(in IntentRecord, p ConversionPreview, ev ReceiptGaugeStorage) error {
	t := ev.Evidence.Evidence.Evidence.Evidence
	r := t.Receipt
	if r.Sequence <= 0 || !validReceiptHeader(ev.Block) || r.Observation.Receipt == nil {
		return ErrIntent
	}
	raw, e := json.Marshal(r.Observation)
	if e != nil || receiptDigest(raw) != r.Digest {
		return ErrIntent
	}
	h := ev.Block
	o := r.Observation
	if h.Hash != o.Receipt.BlockHash || h.Number != o.Receipt.BlockNumber {
		return ErrIntent
	}
	timestamp, e := h.Time()
	headTime, he := o.Head.Time()
	finalizedTime, fe := o.Finalized.Time()
	if e != nil || he != nil || fe != nil || timestamp > headTime || timestamp > finalizedTime || (h.Number == o.Head.Number && h != o.Head) || (h.Number == o.Finalized.Number && h != o.Finalized) {
		return ErrIntent
	}
	event, e := matchReceiptEvents(in, p, o)
	if e != nil {
		return ErrIntent
	}
	event.ReceiptSequence = r.Sequence
	event.ReceiptDigest = r.Digest
	if !reflect.DeepEqual(event, t.Events) || chainrpc.ValidateCallTrace(t.Trace) != nil || matchTraceRoot(in, event, t.Trace) != nil {
		return ErrIntent
	}
	state := ev.Evidence.Evidence.State
	if chainrpc.ValidateTransactionStateTrace(state) != nil {
		return ErrIntent
	}
	calls, e := matchTraceAccounting(p, event, t.Trace)
	if e != nil || !reflect.DeepEqual(calls, ev.Evidence.Evidence.Evidence.Accounting) {
		return ErrIntent
	}
	creators, e := matchCreatorStorage(p, event, calls, state)
	if e != nil || !reflect.DeepEqual(creators, ev.Evidence.Evidence.CreatorStorage) {
		return ErrIntent
	}
	liabilities, e := matchLiabilityStorage(p, event, state)
	if e != nil || !reflect.DeepEqual(liabilities, ev.Evidence.Liabilities) {
		return ErrIntent
	}
	gauge, e := matchGaugeStorage(p, event, calls, state, timestamp)
	if e != nil || !reflect.DeepEqual(gauge, ev.Gauge) {
		return ErrIntent
	}
	activation, e := matchGaugeActivation(p, state, gauge, timestamp)
	if e != nil || !reflect.DeepEqual(activation, ev.Activation) {
		return ErrIntent
	}
	remainders, e := matchGaugeRemainders(p, state, gauge, t.Trace)
	if e != nil || !reflect.DeepEqual(remainders, ev.Remainders) {
		return ErrIntent
	}
	balances, e := matchAssetBalances(p, event, calls, creators, liabilities, t.Trace, state)
	if e != nil || !reflect.DeepEqual(balances, ev.Balances) {
		return ErrIntent
	}
	return nil
}

func (s Store) executionMaterial(ctx context.Context, tx pgx.Tx, scope WorkScope, key string, lock bool) (IntentRecord, SignedTransaction, ConversionPreview, error) {
	in, signed, e := s.receiptMaterialWithLock(ctx, tx, scope, key, lock)
	if e != nil {
		return in, signed, ConversionPreview{}, ErrIntent
	}
	var raw []byte
	if e = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.settlement_checks WHERE sequence=$1`, in.Intent.CheckSequence).Scan(&raw); e != nil || receiptDigest(raw) != in.Intent.CheckDigest {
		return in, signed, ConversionPreview{}, ErrIntent
	}
	var proof struct{ Result checkedEnvelope }
	if json.Unmarshal(raw, &proof) != nil {
		return in, signed, ConversionPreview{}, ErrIntent
	}
	return in, signed, proof.Result.Preview, nil
}
func checkEvidenceReceipt(ctx context.Context, tx pgx.Tx, key, hash string, ev ReceiptGaugeStorage) error {
	r := ev.Evidence.Evidence.Evidence.Evidence.Receipt
	var raw []byte
	var digest string
	if tx.QueryRow(ctx, `SELECT payload,digest FROM tickergarden.settlement_receipt_observations WHERE job_key=$1 AND sequence=$2`, key, r.Sequence).Scan(&raw, &digest) != nil || receiptDigest(raw) != digest || digest != r.Digest {
		return ErrIntent
	}
	var o ReceiptObservation
	if json.Unmarshal(raw, &o) != nil || !reflect.DeepEqual(o, r.Observation) || o.TransactionHash != hash {
		return ErrIntent
	}
	return nil
}

// RecordExecutionEvidence accepts no imported JSON. It obtains fresh evidence,
// replays it and commits a bounded immutable record without changing job status.
func (s Store) RecordExecutionEvidence(ctx context.Context, rpc ReceiptStateRPC, scope WorkScope, key string) (ExecutionEvidenceRecord, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID || rpc == nil {
		return ExecutionEvidenceRecord{}, ErrIntent
	}
	ctx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	ev, e := s.TraceGaugeStorage(ctx, rpc, scope, key)
	if e != nil {
		return ExecutionEvidenceRecord{}, e
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if e != nil {
		return ExecutionEvidenceRecord{}, ErrIntent
	}
	defer tx.Rollback(ctx)
	in, signed, p, e := s.executionMaterial(ctx, tx, scope, key, true)
	if e != nil {
		return ExecutionEvidenceRecord{}, e
	}
	if checkEvidenceReceipt(ctx, tx, key, signed.TransactionHash, ev) != nil || replayExecutionEvidence(in, p, ev) != nil {
		return ExecutionEvidenceRecord{}, ErrIntent
	}
	trace := ev.Evidence.Evidence.Evidence.Evidence
	if recheckTraceReceipt(ctx, rpc, trace.Receipt, trace.Events.TransactionHash) != nil {
		return ExecutionEvidenceRecord{}, ErrIntent
	}
	h, e := rpc.Header(ctx, ev.Block.Number)
	if e != nil || h != ev.Block {
		return ExecutionEvidenceRecord{}, ErrIntent
	}
	raw, e := json.Marshal(ev)
	if e != nil || len(raw) > executionEvidenceLimit {
		return ExecutionEvidenceRecord{}, ErrIntent
	}
	out := ExecutionEvidenceRecord{Digest: receiptDigest(raw), Evidence: ev}
	e = tx.QueryRow(ctx, `INSERT INTO tickergarden.settlement_execution_evidence(job_key,receipt_sequence,intent_digest,payload,digest) VALUES($1,$2,$3,$4,$5) RETURNING sequence`, key, trace.Receipt.Sequence, in.Digest, raw, out.Digest).Scan(&out.Sequence)
	stamp, e2 := trace.Receipt.Observation.Head.Time()
	now := time.Now().Unix()
	if e != nil || e2 != nil || stamp > uint64(now+5) || now-int64(stamp) > 120 || tx.Commit(ctx) != nil {
		return ExecutionEvidenceRecord{}, ErrIntent
	}
	return out, nil
}

func (s Store) executionEvidenceRead(ctx context.Context, scope WorkScope, key string, sequence, after int64) ([]ExecutionEvidenceRecord, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID || !hashPattern.MatchString("0x"+key) || sequence < 0 || after < 0 {
		return nil, ErrIntent
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, ErrIntent
	}
	defer tx.Rollback(ctx)
	in, signed, p, e := s.executionMaterial(ctx, tx, scope, key, false)
	if e != nil {
		return nil, e
	}
	rows, e := tx.Query(ctx, `SELECT sequence,receipt_sequence,intent_digest,payload,digest FROM tickergarden.settlement_execution_evidence WHERE job_key=$1 AND (($2::bigint>0 AND sequence=$2) OR ($2::bigint=0 AND sequence>$3)) ORDER BY sequence LIMIT 5`, key, sequence, after)
	if e != nil {
		return nil, ErrIntent
	}
	out := []ExecutionEvidenceRecord{}
	for rows.Next() {
		var r ExecutionEvidenceRecord
		var receiptID int64
		var intentDigest string
		var raw []byte
		if rows.Scan(&r.Sequence, &receiptID, &intentDigest, &raw, &r.Digest) != nil || len(raw) > executionEvidenceLimit || receiptDigest(raw) != r.Digest || intentDigest != in.Digest || json.Unmarshal(raw, &r.Evidence) != nil {
			rows.Close()
			return nil, ErrIntent
		}
		if replayExecutionEvidence(in, p, r.Evidence) != nil || r.Evidence.Evidence.Evidence.Evidence.Evidence.Receipt.Sequence != receiptID {
			rows.Close()
			return nil, ErrIntent
		}
		out = append(out, r)
	}
	if rows.Err() != nil {
		rows.Close()
		return nil, ErrIntent
	}
	rows.Close()
	for _, r := range out {
		if checkEvidenceReceipt(ctx, tx, key, signed.TransactionHash, r.Evidence) != nil {
			return nil, ErrIntent
		}
	}
	if sequence > 0 && len(out) != 1 {
		return nil, ErrIntent
	}
	if tx.Commit(ctx) != nil {
		return nil, ErrIntent
	}
	return out, nil
}
func (s Store) ExecutionEvidence(ctx context.Context, scope WorkScope, key string, sequence int64) (ExecutionEvidenceRecord, error) {
	if sequence <= 0 {
		return ExecutionEvidenceRecord{}, ErrIntent
	}
	rows, e := s.executionEvidenceRead(ctx, scope, key, sequence, 0)
	if e != nil {
		return ExecutionEvidenceRecord{}, e
	}
	return rows[0], nil
}
func (s Store) ExecutionEvidenceHistory(ctx context.Context, scope WorkScope, key string, after int64) ([]ExecutionEvidenceSummary, error) {
	records, e := s.executionEvidenceRead(ctx, scope, key, 0, after)
	if e != nil {
		return nil, e
	}
	out := []ExecutionEvidenceSummary{}
	for _, r := range records {
		trace := r.Evidence.Evidence.Evidence.Evidence.Evidence
		out = append(out, ExecutionEvidenceSummary{Sequence: r.Sequence, Digest: r.Digest, ReceiptSequence: trace.Receipt.Sequence, TransactionHash: trace.Events.TransactionHash, Block: r.Evidence.Block})
	}
	return out, nil
}
