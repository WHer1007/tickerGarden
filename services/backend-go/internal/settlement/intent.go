package settlement

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"math"
	"math/big"
	"reflect"
	"strconv"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/txaccount"
	"time"
)

var ErrIntent = errors.New("settlement intent unavailable or inconsistent")

type ExecutionPolicy struct {
	GasLimit             string `json:"gasLimit"`
	MaxFeePerGas         string `json:"maxFeePerGas"`
	MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas"`
	MaximumGasCost       string `json:"maximumGasCost"`
}
type TransactionIntent struct {
	JobKey         string              `json:"jobKey"`
	ChainID        uint64              `json:"chainId"`
	GenesisHash    string              `json:"genesisHash"`
	Nonce          string              `json:"nonce"`
	Call           chainrpc.IntentCall `json:"call"`
	Fees           ExecutionPolicy     `json:"fees"`
	MaximumGasCost string              `json:"maximumGasCost"`
	CheckSequence  int64               `json:"checkSequence"`
	CheckDigest    string              `json:"checkDigest"`
	Block          chainrpc.Header     `json:"block"`
	Deadline       int64               `json:"deadline"`
	Type           string              `json:"type"`
	Status         string              `json:"status"`
}
type IntentRecord struct {
	Digest string            `json:"digest"`
	Intent TransactionIntent `json:"intent"`
}
type IntentRPC interface {
	ConversionPreviewObserver
	PendingNonce(context.Context, string) (uint64, error)
	SimulateIntentAt(context.Context, chainrpc.IntentCall, string) ([]byte, error)
}
type checkedEnvelope struct {
	Preview          ConversionPreview `json:"preview"`
	ReferenceCheck   ReferenceCheck    `json:"referenceCheck"`
	QuoteObservation ConversionQuote   `json:"quoteObservation"`
}

func executionCall(p ConversionPreview, nonce uint64, f ExecutionPolicy) (chainrpc.IntentCall, string, error) {
	gas, e := amount(f.GasLimit)
	if e != nil || gas.BitLen() > 63 || gas.Cmp(big.NewInt(21000)) < 0 || nonce >= math.MaxInt64 {
		return chainrpc.IntentCall{}, "", ErrIntent
	}
	fee, e := amount(f.MaxFeePerGas)
	if e != nil || fee.Sign() == 0 {
		return chainrpc.IntentCall{}, "", ErrIntent
	}
	tip, e := amount(f.MaxPriorityFeePerGas)
	if e != nil || tip.Cmp(fee) > 0 {
		return chainrpc.IntentCall{}, "", ErrIntent
	}
	cap, e := amount(f.MaximumGasCost)
	if e != nil || cap.Sign() == 0 {
		return chainrpc.IntentCall{}, "", ErrIntent
	}
	cost := new(big.Int).Mul(gas, fee)
	if cost.BitLen() > 256 || cost.Cmp(cap) > 0 {
		return chainrpc.IntentCall{}, "", ErrIntent
	}
	if p.Candidate.Plan == nil || len(p.Candidate.Plan.Batches) != 1 || p.From != p.Candidate.State.Operator || p.To != p.Candidate.State.FeeVault || !validAddress(p.From) || !validAddress(p.To) || p.Value != "0x0" {
		return chainrpc.IntentCall{}, "", ErrIntent
	}
	data, e := conversionData(p.Candidate.Plan.Batches[0])
	if e != nil || data != p.Data {
		return chainrpc.IntentCall{}, "", ErrIntent
	}
	return chainrpc.IntentCall{From: p.From, To: p.To, Data: p.Data, Value: "0x0", Gas: "0x" + gas.Text(16), Nonce: "0x" + strconv.FormatUint(nonce, 16), MaxFeePerGas: "0x" + fee.Text(16), MaxPriorityFeePerGas: "0x" + tip.Text(16)}, cost.String(), nil
}

func loadWorkForIntent(ctx context.Context, tx pgx.Tx, scope WorkScope, key string) (WorkSpec, error) {
	return loadWorkMaterial(ctx, tx, scope, key, true)
}

func loadWorkMaterial(ctx context.Context, tx pgx.Tx, scope WorkScope, key string, lock bool) (WorkSpec, error) {
	var raw []byte
	var status, market, run string
	query := `SELECT payload,status,market_id,run_id FROM tickergarden.settlement_work WHERE job_key=$1 AND chain_id=$2 AND genesis_hash=$3 AND operator=$4`
	if lock {
		query += " FOR UPDATE"
	}
	err := tx.QueryRow(ctx, query, key, scope.ChainID, scope.GenesisHash, scope.Operator).Scan(&raw, &status, &market, &run)
	var spec WorkSpec
	if err != nil || status != "checked_unsigned" || json.Unmarshal(raw, &spec) != nil {
		return spec, ErrIntent
	}
	canonical, digest, err := workPayload(spec)
	if err != nil || key != digest || !bytes.Equal(canonical, raw) || spec.Manifest.ChainID != scope.ChainID || spec.Manifest.GenesisHash != scope.GenesisHash || spec.Selection.Operator != scope.Operator || spec.Selection.MarketID != market || spec.RunID != run {
		return WorkSpec{}, ErrIntent
	}
	return spec, nil
}

func readIntent(ctx context.Context, tx pgx.Tx, scope WorkScope, key string, spec WorkSpec) (IntentRecord, error) {
	var r IntentRecord
	var raw []byte
	var nonce uint64
	var seq int64
	var cost string
	err := tx.QueryRow(ctx, `SELECT payload,digest,nonce,check_sequence,maximum_gas_cost::text FROM tickergarden.settlement_intents WHERE job_key=$1 AND chain_id=$2 AND genesis_hash=$3 AND sender=$4`, key, scope.ChainID, scope.GenesisHash, scope.Operator).Scan(&raw, &r.Digest, &nonce, &seq, &cost)
	if err != nil {
		return r, err
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != r.Digest || json.Unmarshal(raw, &r.Intent) != nil {
		return IntentRecord{}, ErrIntent
	}
	in := r.Intent
	if in.JobKey != key || in.ChainID != scope.ChainID || in.GenesisHash != scope.GenesisHash || in.Nonce != strconv.FormatUint(nonce, 10) || in.CheckSequence != seq || in.MaximumGasCost != cost || in.Type != "0x2" || in.Status != "intent_prepared" {
		return IntentRecord{}, ErrIntent
	}
	var evidence []byte
	var evidenceDigest string
	if tx.QueryRow(ctx, `SELECT payload,digest FROM tickergarden.settlement_checks WHERE sequence=$1 AND chain_id=$2 AND genesis_hash=$3`, seq, scope.ChainID, scope.GenesisHash).Scan(&evidence, &evidenceDigest) != nil {
		return IntentRecord{}, ErrIntent
	}
	evidenceSum := sha256.Sum256(evidence)
	var envelope struct{ Result checkedEnvelope }
	if evidenceDigest != in.CheckDigest || hex.EncodeToString(evidenceSum[:]) != in.CheckDigest || json.Unmarshal(evidence, &envelope) != nil {
		return IntentRecord{}, ErrIntent
	}
	p := envelope.Result.Preview
	if p.Candidate.State.MarketID != spec.Selection.MarketID || !reflect.DeepEqual(envelope.Result.ReferenceCheck.Policy, spec.Policy) {
		return IntentRecord{}, ErrIntent
	}
	call, bound, e := executionCall(p, nonce, in.Fees)
	if e != nil || call != in.Call || call.From != scope.Operator || bound != cost || p.Candidate.State.ChainID != scope.ChainID || p.Candidate.State.GenesisHash != scope.GenesisHash || in.Block != p.Candidate.State.Block || in.Deadline != p.Candidate.Plan.Deadline {
		return IntentRecord{}, ErrIntent
	}
	return r, nil
}

func (s Store) Intent(ctx context.Context, scope WorkScope, key string) (IntentRecord, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID {
		return IntentRecord{}, ErrIntent
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return IntentRecord{}, ErrIntent
	}
	defer tx.Rollback(ctx)
	spec, err := loadWorkForIntent(ctx, tx, scope, key)
	if err != nil {
		return IntentRecord{}, err
	}
	r, err := readIntent(ctx, tx, scope, key, spec)
	if err != nil {
		return IntentRecord{}, ErrIntent
	}
	if tx.Commit(ctx) != nil {
		return IntentRecord{}, ErrIntent
	}
	return r, nil
}

// PrepareIntent performs new live checks; a stored audit result is never reused
// as freshness evidence. An existing exact intent is returned only for recovery.
func (s Store) PrepareIntent(ctx context.Context, rpc IntentRPC, scope WorkScope, key string, fees ExecutionPolicy) (IntentRecord, bool, error) {
	if s.Pool == nil || rpc == nil || s.ChainID != scope.ChainID {
		return IntentRecord{}, false, ErrIntent
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return IntentRecord{}, false, ErrIntent
	}
	defer tx.Rollback(ctx)
	spec, err := loadWorkForIntent(ctx, tx, scope, key)
	if err != nil {
		return IntentRecord{}, false, err
	}
	existing, err := readIntent(ctx, tx, scope, key, spec)
	if err == nil {
		if existing.Intent.Fees != fees {
			return IntentRecord{}, false, ErrIntent
		}
		if tx.Commit(ctx) != nil {
			return IntentRecord{}, false, ErrIntent
		}
		return existing, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return IntentRecord{}, false, ErrIntent
	}
	in := spec.Selection
	in.Deadline = time.Now().Unix() + spec.DeadlineSeconds
	v, err := VerifyAutoConversion(ctx, rpc, spec.Manifest, in, spec.Policy)
	if err != nil {
		return IntentRecord{}, false, err
	}
	var checked checkedEnvelope
	if json.Unmarshal(v.payload, &checked) != nil {
		return IntentRecord{}, false, ErrIntent
	}
	p := checked.Preview
	if err = txaccount.Claim(ctx, tx, scope.ChainID, scope.GenesisHash, scope.Operator, "settlement"); err != nil {
		return IntentRecord{}, false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO tickergarden.settlement_nonce_accounts(chain_id,genesis_hash,sender,next_nonce) VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING`, scope.ChainID, scope.GenesisHash, scope.Operator)
	if err != nil {
		return IntentRecord{}, false, ErrIntent
	}
	var nonce uint64
	if tx.QueryRow(ctx, `SELECT next_nonce FROM tickergarden.settlement_nonce_accounts WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 FOR UPDATE`, scope.ChainID, scope.GenesisHash, scope.Operator).Scan(&nonce) != nil {
		return IntentRecord{}, false, ErrIntent
	}
	pending, err := rpc.PendingNonce(ctx, scope.Operator)
	if err != nil {
		return IntentRecord{}, false, ErrIntent
	}
	if pending > nonce {
		nonce = pending
	}
	call, cost, err := executionCall(p, nonce, fees)
	if err != nil {
		return IntentRecord{}, false, err
	}
	var held string
	if tx.QueryRow(ctx, `SELECT COALESCE(sum(maximum_gas_cost),0)::text FROM tickergarden.settlement_intents i WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 AND NOT EXISTS (SELECT 1 FROM tickergarden.settlement_reservation_releases r WHERE r.job_key=i.job_key)`, scope.ChainID, scope.GenesisHash, scope.Operator).Scan(&held) != nil {
		return IntentRecord{}, false, ErrIntent
	}
	reserved, e := amount(held)
	if e != nil {
		return IntentRecord{}, false, ErrIntent
	}
	current, _ := amount(cost)
	reserved.Add(reserved, current)
	balance, e := rpc.BalanceAt(ctx, scope.Operator, p.Candidate.State.Block.Hash)
	if e != nil {
		return IntentRecord{}, false, ErrIntent
	}
	available, e := amount(balance)
	if e != nil || available.Cmp(reserved) < 0 {
		return IntentRecord{}, false, ErrIntent
	}
	result, err := rpc.SimulateIntentAt(ctx, call, p.Candidate.State.Block.Hash)
	if err != nil {
		return IntentRecord{}, false, ErrIntent
	}
	fields, err := events.DecodeStatic([]events.Input{{Name: "spent", Type: "uint256"}, {Name: "received", Type: "uint256"}}, result)
	if err != nil || fields["spent"] != p.Spent || fields["received"] != p.Received {
		return IntentRecord{}, false, ErrIntent
	}
	currentPending, err := rpc.PendingNonce(ctx, scope.Operator)
	if err != nil || currentPending != pending {
		return IntentRecord{}, false, ErrIntent
	}
	header, err := rpc.Header(ctx, p.Candidate.State.Block.Number)
	if err != nil || header != p.Candidate.State.Block {
		return IntentRecord{}, false, ErrIntent
	}
	now := time.Now().Unix()
	if now-checked.QuoteObservation.Quote.QuotedAt > 30 || checked.QuoteObservation.Quote.QuotedAt > now {
		return IntentRecord{}, false, ErrIntent
	}
	if _, err = CheckReferences(p, spec.Policy, checked.ReferenceCheck.References, now); err != nil {
		return IntentRecord{}, false, err
	}
	evidence, err := s.recordIn(ctx, tx, v)
	if err != nil {
		return IntentRecord{}, false, err
	}
	intent := TransactionIntent{JobKey: key, ChainID: scope.ChainID, GenesisHash: scope.GenesisHash, Nonce: strconv.FormatUint(nonce, 10), Call: call, Fees: fees, MaximumGasCost: cost, CheckSequence: evidence.Sequence, CheckDigest: evidence.Digest, Block: header, Deadline: p.Candidate.Plan.Deadline, Type: "0x2", Status: "intent_prepared"}
	raw, err := json.Marshal(intent)
	if err != nil {
		return IntentRecord{}, false, ErrIntent
	}
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])
	_, err = tx.Exec(ctx, `INSERT INTO tickergarden.settlement_intents(job_key,chain_id,genesis_hash,sender,nonce,check_sequence,maximum_gas_cost,payload,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, key, scope.ChainID, scope.GenesisHash, scope.Operator, nonce, evidence.Sequence, cost, raw, digest)
	if err != nil {
		return IntentRecord{}, false, ErrIntent
	}
	_, err = tx.Exec(ctx, `UPDATE tickergarden.settlement_nonce_accounts SET next_nonce=$4 WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3`, scope.ChainID, scope.GenesisHash, scope.Operator, nonce+1)
	if err != nil || tx.Commit(ctx) != nil {
		return IntentRecord{}, false, ErrIntent
	}
	return IntentRecord{Digest: digest, Intent: intent}, false, nil
}
