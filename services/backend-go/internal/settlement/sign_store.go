package settlement

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"reflect"
	"strconv"
	"time"
)

type SignResult struct {
	Status      string             `json:"status"`
	RequestID   string             `json:"requestId"`
	NotAfter    int64              `json:"notAfter"`
	Transaction *SignedTransaction `json:"transaction,omitempty"`
}

func readSign(ctx context.Context, tx pgx.Tx, r IntentRecord, spec WorkSpec) (SignRequest, []byte, error) {
	var request, raw []byte
	var digest, intentDigest string
	var hash *string
	var seq int64
	err := tx.QueryRow(ctx, `SELECT request_payload,request_digest,intent_digest,check_sequence,raw_transaction,transaction_hash FROM tickergarden.settlement_sign_requests WHERE job_key=$1`, r.Intent.JobKey).Scan(&request, &digest, &intentDigest, &seq, &raw, &hash)
	if err != nil {
		return SignRequest{}, nil, err
	}
	q, err := validateAuthorization(ctx, tx, r, spec, request, digest, intentDigest, seq, "settlement-sign-v1")
	if err != nil {
		return q, nil, err
	}
	if raw != nil {
		signed, e := ValidateSigned(r, raw)
		if e != nil || hash == nil || signed.TransactionHash != *hash {
			return q, nil, ErrIntent
		}
	} else if hash != nil {
		return q, nil, ErrIntent
	}
	return q, raw, nil
}

func signResult(q SignRequest, raw []byte) (SignResult, error) {
	result := SignResult{Status: "signing_unknown", RequestID: q.RequestID, NotAfter: q.NotAfter}
	if raw != nil {
		signed, err := ValidateSigned(q.Intent, raw)
		if err != nil {
			return SignResult{}, err
		}
		result.Status = "signed_stored"
		result.Transaction = &signed
	}
	return result, nil
}

// Sign persists the unknown outcome before one external invocation. Retries
// never re-invoke the signer, even after the authorization has expired.
func (s Store) Sign(ctx context.Context, rpc IntentRPC, signer Signer, scope WorkScope, key string, fees ExecutionPolicy) (SignResult, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID || rpc == nil || signer == nil {
		return SignResult{}, ErrIntent
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SignResult{}, ErrIntent
	}
	defer tx.Rollback(ctx)
	spec, err := loadWorkForIntent(ctx, tx, scope, key)
	if err != nil {
		return SignResult{}, err
	}
	r, err := readIntent(ctx, tx, scope, key, spec)
	if err != nil || r.Intent.Fees != fees {
		return SignResult{}, ErrIntent
	}
	q, raw, err := readSign(ctx, tx, r, spec)
	if err == nil {
		if tx.Commit(ctx) != nil {
			return SignResult{}, ErrIntent
		}
		return signResult(q, raw)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return SignResult{}, ErrIntent
	}
	q, err = s.authorizeIntent(ctx, tx, rpc, spec, r, "settlement-sign-v1")
	if err != nil {
		return SignResult{}, err
	}
	request, err := json.Marshal(q)
	if err != nil || len(request) > 1<<20 {
		return SignResult{}, ErrIntent
	}
	sum := sha256.Sum256(request)
	_, err = tx.Exec(ctx, `INSERT INTO tickergarden.settlement_sign_requests(job_key,intent_digest,check_sequence,request_payload,request_digest) VALUES($1,$2,$3,$4,$5)`, key, r.Digest, q.CheckSequence, request, hex.EncodeToString(sum[:]))
	if err != nil || tx.Commit(ctx) != nil {
		return SignResult{}, ErrIntent
	}
	unknown, _ := signResult(q, nil)
	if ctx.Err() != nil {
		return unknown, nil
	}
	raw, err = signer.Sign(ctx, q)
	if err != nil {
		return unknown, nil
	}
	if _, err = ValidateSigned(r, raw); err != nil {
		return unknown, nil
	}
	return s.ImportSigned(ctx, scope, key, raw)
}

// ImportSigned only recovers bytes for an existing authorized request. It does
// not renew authorization and never submits the transaction.
func (s Store) ImportSigned(ctx context.Context, scope WorkScope, key string, raw []byte) (SignResult, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID {
		return SignResult{}, ErrIntent
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SignResult{}, ErrIntent
	}
	defer tx.Rollback(ctx)
	spec, err := loadWorkForIntent(ctx, tx, scope, key)
	if err != nil {
		return SignResult{}, err
	}
	r, err := readIntent(ctx, tx, scope, key, spec)
	if err != nil {
		return SignResult{}, ErrIntent
	}
	q, existing, err := readSign(ctx, tx, r, spec)
	if err != nil {
		return SignResult{}, ErrIntent
	}
	signed, err := ValidateSigned(r, raw)
	if err != nil {
		return SignResult{}, err
	}
	if existing != nil && !bytes.Equal(existing, raw) {
		return SignResult{}, ErrIntent
	}
	if existing == nil {
		tag, e := tx.Exec(ctx, `UPDATE tickergarden.settlement_sign_requests SET raw_transaction=$2,transaction_hash=$3 WHERE job_key=$1 AND raw_transaction IS NULL`, key, raw, signed.TransactionHash)
		if e != nil || tag.RowsAffected() != 1 {
			return SignResult{}, ErrIntent
		}
	}
	if tx.Commit(ctx) != nil {
		return SignResult{}, ErrIntent
	}
	return signResult(q, raw)
}
func (s Store) Signed(ctx context.Context, scope WorkScope, key string) (SignResult, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID {
		return SignResult{}, ErrIntent
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SignResult{}, ErrIntent
	}
	defer tx.Rollback(ctx)
	spec, err := loadWorkForIntent(ctx, tx, scope, key)
	if err != nil {
		return SignResult{}, err
	}
	r, err := readIntent(ctx, tx, scope, key, spec)
	if err != nil {
		return SignResult{}, ErrIntent
	}
	q, raw, err := readSign(ctx, tx, r, spec)
	if err != nil {
		return SignResult{}, ErrIntent
	}
	if tx.Commit(ctx) != nil {
		return SignResult{}, ErrIntent
	}
	return signResult(q, raw)
}

// validateAuthorization rechecks immutable historical evidence, without renewing it.
func validateAuthorization(ctx context.Context, tx pgx.Tx, r IntentRecord, spec WorkSpec, request []byte, digest, intentDigest string, seq int64, version string) (SignRequest, error) {
	sum := sha256.Sum256(request)
	var q SignRequest
	if hex.EncodeToString(sum[:]) != digest || json.Unmarshal(request, &q) != nil || q.Version != version || q.RequestID != r.Digest || intentDigest != r.Digest || !reflect.DeepEqual(q.Intent, r) || q.CheckSequence != seq || q.NotAfter <= 0 {
		return q, ErrIntent
	}
	var evidence []byte
	var checkDigest string
	err := tx.QueryRow(ctx, `SELECT payload,digest FROM tickergarden.settlement_checks WHERE sequence=$1 AND chain_id=$2 AND genesis_hash=$3 AND market_id=$4`, seq, r.Intent.ChainID, r.Intent.GenesisHash, spec.Selection.MarketID).Scan(&evidence, &checkDigest)
	proofSum := sha256.Sum256(evidence)
	if err != nil || checkDigest != q.CheckDigest || hex.EncodeToString(proofSum[:]) != checkDigest || string(evidence) != q.EvidenceJSON {
		return q, ErrIntent
	}
	var proof struct{ Result checkedEnvelope }
	if json.Unmarshal(evidence, &proof) != nil || !reflect.DeepEqual(proof.Result.ReferenceCheck.Policy, spec.Policy) {
		return q, ErrIntent
	}
	p := proof.Result.Preview
	stamp, e := p.Candidate.State.Block.Time()
	if e != nil || q.NotAfter > r.Intent.Deadline || q.NotAfter > int64(stamp)+120 || q.NotAfter > proof.Result.ReferenceCheck.CheckedAt+30 {
		return q, ErrIntent
	}
	for _, ref := range proof.Result.ReferenceCheck.References {
		if q.NotAfter > ref.Price.ExpiresAt || q.NotAfter > ref.Price.ObservedAt+spec.Policy.MaxAgeSeconds {
			return q, ErrIntent
		}
	}
	if _, e = CheckReferences(p, spec.Policy, proof.Result.ReferenceCheck.References, proof.Result.ReferenceCheck.CheckedAt); e != nil {
		return q, ErrIntent
	}
	nonce, err := strconv.ParseUint(r.Intent.Nonce, 10, 63)
	if err != nil {
		return q, ErrIntent
	}
	call, _, err := executionCall(proof.Result.Preview, nonce, r.Intent.Fees)
	if err != nil || call != r.Intent.Call {
		return q, ErrIntent
	}

	return q, nil
}
