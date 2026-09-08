package settlement

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"math/big"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/postgres"
	"time"
)

type executionHistoryRPC struct {
	*receiptFixture
	trace chainrpc.CallTrace
	state chainrpc.TransactionStateTrace
}

func (f *executionHistoryRPC) TransactionCallTrace(context.Context, string) (chainrpc.CallTrace, error) {
	return f.trace, nil
}
func (f *executionHistoryRPC) TransactionState(context.Context, string) (chainrpc.TransactionStateTrace, error) {
	return f.state, nil
}

type missingExecutionState struct{ ReceiptStateRPC }

func (missingExecutionState) TransactionState(context.Context, string) (chainrpc.TransactionStateTrace, error) {
	return chainrpc.TransactionStateTrace{}, nil
}

// Signed synthetic execution material exercises the public nonempty read API.
// Preparation and broadcast are not exercised; recording uses a controlled RPC fixture.
func TestIsolatedSettlementReceiptExecutionHistory(t *testing.T) {
	dsn := os.Getenv("TG_SETTLEMENT_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 2)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	var raw []byte
	var spec WorkSpec
	if pool.QueryRow(ctx, `SELECT payload FROM tickergarden.settlement_work WHERE status='checked_unsigned' LIMIT 1`).Scan(&raw) != nil || json.Unmarshal(raw, &spec) != nil {
		t.Fatal("work template")
	}
	in, p, ev := executionFixture(t)
	var liveRPC *chainrpc.Client
	var liveSigned *types.Transaction
	if os.Getenv("TG_LOCAL_EXECUTION_FIXTURE") != "" {
		var encoded string
		in, p, ev, liveRPC, encoded = localFeeVaultEvidence(t)
		raw, err := hex.DecodeString(strings.TrimPrefix(encoded, "0x"))
		if err != nil {
			t.Fatal(err)
		}
		liveSigned = new(types.Transaction)
		if liveSigned.UnmarshalBinary(raw) != nil {
			t.Fatal("live signed transaction")
		}
	}
	_, policy, refs, keys, now := referenceFixture(t)
	signer, e := crypto.GenerateKey()
	if e != nil {
		t.Fatal(e)
	}
	sender := strings.ToLower(crypto.PubkeyToAddress(signer.PublicKey).Hex())
	if liveSigned != nil {
		sender = in.Intent.Call.From
		spec.Manifest.GenesisHash = in.Intent.GenesisHash
		spec.Manifest.ChainID = in.Intent.ChainID
	}
	scope := WorkScope{ChainID: spec.Manifest.ChainID, GenesisHash: spec.Manifest.GenesisHash, Operator: sender}
	spec.RunID = "history-" + sender[2:]
	spec.Selection.Operator = sender
	spec.Selection.MarketID = p.Candidate.Plan.Batches[0].MarketID
	policy.ChainID = scope.ChainID
	policy.GenesisHash = scope.GenesisHash
	policy.MarketID = spec.Selection.MarketID
	policy.MemeToken = p.Candidate.State.MemeToken
	policy.QuoteAsset = p.Candidate.State.QuoteAsset
	for i := range policy.Sources {
		policy.Sources[i].Endpoint = fmt.Sprintf("https://fixture%d.invalid", i)
	}
	spec.Policy = policy
	work, key, e := workPayload(spec)
	if e != nil {
		t.Fatal("work", e)
	}
	p.From = sender
	p.Value = "0x0"
	p.Spent = "1"
	p.Received = "100"
	p.Candidate.State.ChainID = scope.ChainID
	p.Candidate.State.GenesisHash = scope.GenesisHash
	p.Candidate.State.Operator = sender
	p.Candidate.State.MarketID = policy.MarketID
	p.Candidate.State.Block = ev.Block
	if liveSigned == nil {
		p.Candidate.State.Block.Timestamp = fmt.Sprintf("0x%x", now)
	}
	p.Candidate.Plan.Deadline = p.Candidate.Plan.Batches[0].Deadline
	if liveSigned == nil {
		p.Candidate.Plan.Deadline = now + 100
	}
	p.Candidate.Plan.MinimumQuote = "99"
	p.Candidate.Plan.Batches[0].Deadline = p.Candidate.Plan.Deadline
	p.Candidate.Request.TotalMeme = "3"
	p.Candidate.Request.RequestDigest = "0x" + strings.Repeat("c", 64)
	p.Candidate.Plan.RequestDigest = p.Candidate.Request.RequestDigest
	p.Route.PoolState.ActiveLiquidity = "100"
	p.Data, e = conversionData(p.Candidate.Plan.Batches[0])
	if e != nil {
		t.Fatal(e)
	}
	for i := range refs {
		price := refs[i].Price
		price.ChainID = scope.ChainID
		price.GenesisHash = scope.GenesisHash
		price.MarketID = policy.MarketID
		price.MemeToken = policy.MemeToken
		price.QuoteAsset = policy.QuoteAsset
		price.QuoteUnits = "100"
		refs[i] = signReference(t, price, keys[i])
	}
	checked, e := CheckReferences(p, policy, refs, now)
	if e != nil {
		t.Fatal("references", e)
	}
	checked.Policy = policy
	checked.References = refs
	proof, _ := json.Marshal(struct{ Result checkedEnvelope }{checkedEnvelope{Preview: p, ReferenceCheck: checked}})
	proofDigest := receiptDigest(proof)
	tx, e := pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	var checkSeq int64
	if tx.QueryRow(ctx, `INSERT INTO tickergarden.settlement_checks(chain_id,genesis_hash,market_id,request_digest,block_hash,digest,payload) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING sequence`, scope.ChainID, scope.GenesisHash, policy.MarketID, p.Candidate.Request.RequestDigest, p.Candidate.State.Block.Hash, proofDigest, proof).Scan(&checkSeq) != nil {
		t.Fatal("check insert")
	}
	exec(`INSERT INTO tickergarden.settlement_work(job_key,chain_id,genesis_hash,operator,market_id,run_id,payload,status,check_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,'checked_unsigned',$8)`, key, scope.ChainID, scope.GenesisHash, sender, policy.MarketID, spec.RunID, work, checkSeq)
	exec(`INSERT INTO tickergarden.transaction_account_roles VALUES($1,$2,$3,'settlement')`, scope.ChainID, scope.GenesisHash, sender)
	exec(`INSERT INTO tickergarden.settlement_nonce_accounts VALUES($1,$2,$3,8)`, scope.ChainID, scope.GenesisHash, sender)
	in.Intent.JobKey = key
	in.Intent.ChainID = scope.ChainID
	in.Intent.GenesisHash = scope.GenesisHash
	in.Intent.Block = p.Candidate.State.Block
	in.Intent.Deadline = p.Candidate.Plan.Deadline
	in.Intent.CheckSequence = checkSeq
	in.Intent.CheckDigest = proofDigest
	nonce := uint64(7)
	if liveSigned != nil {
		nonce = liveSigned.Nonce()
		in.Intent.Fees = ExecutionPolicy{GasLimit: strconv.FormatUint(liveSigned.Gas(), 10), MaxFeePerGas: liveSigned.GasFeeCap().String(), MaxPriorityFeePerGas: liveSigned.GasTipCap().String(), MaximumGasCost: new(big.Int).Mul(new(big.Int).SetUint64(liveSigned.Gas()), liveSigned.GasFeeCap()).String()}
	}
	in.Intent.Nonce = strconv.FormatUint(nonce, 10)
	in.Intent.Call, in.Intent.MaximumGasCost, e = executionCall(p, nonce, in.Intent.Fees)
	if e != nil {
		t.Fatal(e)
	}
	body, _ := json.Marshal(in.Intent)
	in.Digest = receiptDigest(body)
	exec(`INSERT INTO tickergarden.settlement_intents(job_key,chain_id,genesis_hash,sender,nonce,check_sequence,maximum_gas_cost,payload,digest) VALUES($1,$2,$3,$4,$9,$5,$6,$7,$8)`, key, scope.ChainID, scope.GenesisHash, sender, checkSeq, in.Intent.MaximumGasCost, body, in.Digest, nonce)
	data, _ := hex.DecodeString(p.Data[2:])
	to := common.HexToAddress(p.To)
	chain := new(big.Int).SetUint64(scope.ChainID)
	signed, e := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: chain, Nonce: 7, Gas: 21000, GasFeeCap: big.NewInt(2), GasTipCap: big.NewInt(1), To: &to, Data: data}), types.NewLondonSigner(chain), signer)
	if e != nil {
		t.Fatal(e)
	}
	if liveSigned != nil {
		signed = liveSigned
	}
	signedBytes, _ := signed.MarshalBinary()
	if _, e = ValidateSigned(in, signedBytes); e != nil {
		t.Fatal(e)
	}
	auth := SignRequest{Version: "settlement-sign-v1", RequestID: in.Digest, Intent: in, CheckSequence: checkSeq, CheckDigest: proofDigest, EvidenceJSON: string(proof), NotAfter: now + 20}
	authBytes, _ := json.Marshal(auth)
	exec(`INSERT INTO tickergarden.settlement_sign_requests(job_key,intent_digest,check_sequence,request_payload,request_digest,raw_transaction,transaction_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`, key, in.Digest, checkSeq, authBytes, receiptDigest(authBytes), signedBytes, signed.Hash().Hex())
	auth.Version = "settlement-submit-v1"
	authBytes, _ = json.Marshal(auth)
	exec(`INSERT INTO tickergarden.settlement_submissions(job_key,intent_digest,transaction_hash,check_sequence,authorization_payload,authorization_digest,status) VALUES($1,$2,$3,$4,$5,$6,'acknowledged')`, key, in.Digest, signed.Hash().Hex(), checkSeq, authBytes, receiptDigest(authBytes))
	trace := &ev.Evidence.Evidence.Evidence.Evidence
	o := trace.Receipt.Observation
	o.JobKey = key
	o.ChainID = scope.ChainID
	o.GenesisHash = scope.GenesisHash
	o.TransactionHash = signed.Hash().Hex()
	if liveSigned == nil {
		o.Head = p.Candidate.State.Block
		o.Finalized = o.Head
		o = matchingEvents(in, p, o)
		ev.Block = o.Head
		trace.Trace.From = sender
		trace.Trace.Input = p.Data
		for i := range trace.Trace.Calls {
			c := &trace.Trace.Calls[i]
			if c.To == p.Route.Hook {
				c.Input = c.Input[:len(c.Input)-64] + eventWord(fmt.Sprintf("%x", now+100))
			}
		}
	}
	var first ExecutionEvidenceRecord
	for i := 0; i < 7; i++ {
		receiptBody, _ := json.Marshal(o)
		var receiptSeq int64
		if tx.QueryRow(ctx, `INSERT INTO tickergarden.settlement_receipt_observations(job_key,payload,digest) VALUES($1,$2,$3) RETURNING sequence`, key, receiptBody, receiptDigest(receiptBody)).Scan(&receiptSeq) != nil {
			t.Fatal("receipt insert")
		}
		trace.Receipt = ReceiptRecord{Sequence: receiptSeq, Digest: receiptDigest(receiptBody), Observation: o}
		trace.Events, e = matchReceiptEvents(in, p, o)
		if e != nil {
			t.Fatal(e)
		}
		trace.Events.ReceiptSequence = receiptSeq
		trace.Events.ReceiptDigest = trace.Receipt.Digest
		if replayExecutionEvidence(in, p, ev) != nil {
			t.Fatal("replay fixture")
		}
		payload, _ := json.Marshal(ev)
		r := ExecutionEvidenceRecord{Digest: receiptDigest(payload), Evidence: ev}
		if tx.QueryRow(ctx, `INSERT INTO tickergarden.settlement_execution_evidence(job_key,receipt_sequence,intent_digest,payload,digest) VALUES($1,$2,$3,$4,$5) RETURNING sequence`, key, receiptSeq, in.Digest, payload, r.Digest).Scan(&r.Sequence) != nil {
			t.Fatal("evidence insert")
		}
		if i == 0 {
			b, _ := json.Marshal(r)
			_ = json.Unmarshal(b, &first)
		}
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	defer func() {
		for _, table := range []string{"settlement_reservation_releases", "settlement_execution_evidence", "settlement_receipt_observations", "settlement_submissions", "settlement_sign_requests", "settlement_intents", "settlement_work"} {
			_, err := pool.Exec(ctx, `DELETE FROM tickergarden.`+table+` WHERE job_key=$1`, key)
			if err != nil {
				t.Error(err)
			}
		}
		for _, table := range []string{"settlement_nonce_accounts", "transaction_account_roles"} {
			_, _ = pool.Exec(ctx, `DELETE FROM tickergarden.`+table+` WHERE sender=$1 AND chain_id=$2 AND genesis_hash=$3`, sender, scope.ChainID, scope.GenesisHash)
		}
		_, _ = pool.Exec(ctx, `DELETE FROM tickergarden.settlement_checks WHERE sequence=$1`, checkSeq)
	}()
	store := Store{Pool: pool, ChainID: scope.ChainID}
	got, e := store.ExecutionEvidence(ctx, scope, key, first.Sequence)
	if e != nil || !reflect.DeepEqual(got, first) {
		t.Fatal("selected evidence", e)
	}
	page, e := store.ExecutionEvidenceHistory(ctx, scope, key, 0)
	if e != nil || len(page) != 5 {
		t.Fatal("first page", len(page), e)
	}
	next, e := store.ExecutionEvidenceHistory(ctx, scope, key, page[4].Sequence)
	if e != nil || len(next) != 2 || next[0].Sequence <= page[4].Sequence {
		t.Fatal("next page", next, e)
	}
	empty, e := store.ExecutionEvidenceHistory(ctx, scope, key, next[1].Sequence)
	if e != nil || len(empty) != 0 {
		t.Fatal("end page", e)
	}
	provider := &executionHistoryRPC{receiptFixture: &receiptFixture{o: o}, trace: trace.Trace, state: ev.Evidence.Evidence.State}
	var evidenceRPC ReceiptStateRPC = provider
	if liveRPC != nil {
		evidenceRPC = liveRPC
	}
	recorded, err := store.RecordExecutionEvidence(ctx, evidenceRPC, scope, key)
	if err != nil || recorded.Sequence <= next[1].Sequence {
		t.Fatal("record pipeline", err)
	}
	reread, err := store.ExecutionEvidence(ctx, scope, key, recorded.Sequence)
	if err != nil || !reflect.DeepEqual(recorded, reread) {
		t.Fatal("record/read round trip", err)
	}
	last, err := store.ExecutionEvidenceHistory(ctx, scope, key, next[1].Sequence)
	if err != nil || len(last) != 1 || last[0].Sequence != recorded.Sequence {
		t.Fatal("record history", last, err)
	}
	var status string
	var storedNonce int64
	if pool.QueryRow(ctx, `SELECT status FROM tickergarden.settlement_work WHERE job_key=$1`, key).Scan(&status) != nil || status != "checked_unsigned" {
		t.Fatal("record changed job")
	}
	if pool.QueryRow(ctx, `SELECT next_nonce FROM tickergarden.settlement_nonce_accounts WHERE sender=$1`, sender).Scan(&storedNonce) != nil || storedNonce != 8 {
		t.Fatal("record changed nonce")
	}
	if _, err = store.RecordExecutionEvidence(ctx, missingExecutionState{evidenceRPC}, scope, key); err == nil {
		t.Fatal("invalid trace recorded")
	}
	empty, err = store.ExecutionEvidenceHistory(ctx, scope, key, recorded.Sequence)
	if err != nil || len(empty) != 0 {
		t.Fatal("failed trace persisted", err)
	}
	checkReservationRelease(t, ctx, store, scope, key, recorded.Evidence.Evidence.Evidence.Evidence.Evidence.Receipt, evidenceRPC)
	if liveRPC != nil {
		observing := &resumeExecutionRPC{Client: liveRPC}
		for i := 0; i < 2; i++ {
			progress, err := store.AdvanceExecution(ctx, observing, rejectResumeSigner{}, scope, key, in.Intent.Fees)
			if err != nil || progress.State != "accounting_verified" || !progress.AccountingVerified || !progress.ReservationReleased || progress.TransactionHash != signed.Hash().Hex() || progress.EvidenceSequence != first.Sequence {
				t.Fatalf("resume finalized execution: %+v %v", progress, err)
			}
		}
		if observing.sends != 0 || observing.traces != 0 {
			t.Fatal("resume repeated network send or evidence trace", observing.sends, observing.traces)
		}
		t.Log("executor: two finalized resumes authenticate receipts, reuse accounting evidence and never sign/send again")
	}
	// Valid envelope digest cannot hide a modified derived result.
	altered := first.Evidence
	altered.Balances.CoverageMatched = false
	payload, _ := json.Marshal(altered)
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.settlement_execution_evidence SET payload=$1,digest=$2 WHERE sequence=$3`, payload, receiptDigest(payload), first.Sequence); e != nil {
		t.Fatal(e)
	}
	if _, e = store.ExecutionEvidence(ctx, scope, key, first.Sequence); e == nil {
		t.Fatal("tampered record accepted")
	}
	if _, e = store.ExecutionEvidenceHistory(ctx, scope, key, 0); e == nil {
		t.Fatal("tampered page accepted")
	}
}

// This wrapper permits all real read calls while detecting forbidden repeats.
type resumeExecutionRPC struct {
	*chainrpc.Client
	sends, traces int
}

func (r *resumeExecutionRPC) SendRawTransaction(context.Context, []byte) (string, error) {
	r.sends++
	return "", ErrIntent
}
func (r *resumeExecutionRPC) TransactionCallTrace(ctx context.Context, hash string) (chainrpc.CallTrace, error) {
	r.traces++
	return r.Client.TransactionCallTrace(ctx, hash)
}

type rejectResumeSigner struct{}

func (rejectResumeSigner) Sign(context.Context, SignRequest) ([]byte, error) {
	return nil, fmt.Errorf("resuming a stored signature must never call signer")
}
