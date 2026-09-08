package settlement

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type SubmissionRPC interface {
	IntentRPC
	SendRawTransaction(context.Context, []byte) (string, error)
}
type Submission struct {
	JobKey              string `json:"jobKey"`
	IntentDigest        string `json:"intentDigest"`
	TransactionHash     string `json:"transactionHash"`
	CheckSequence       int64  `json:"checkSequence"`
	AuthorizationDigest string `json:"authorizationDigest"`
	Status              string `json:"status"`
}

func readSubmission(ctx context.Context, tx pgx.Tx, r IntentRecord, spec WorkSpec, signed SignedTransaction) (Submission, error) {
	var out Submission
	var body []byte
	err := tx.QueryRow(ctx, `SELECT job_key,intent_digest,transaction_hash,check_sequence,authorization_digest,status,authorization_payload FROM tickergarden.settlement_submissions WHERE job_key=$1`, r.Intent.JobKey).Scan(&out.JobKey, &out.IntentDigest, &out.TransactionHash, &out.CheckSequence, &out.AuthorizationDigest, &out.Status, &body)
	if err != nil {
		return out, err
	}
	if out.IntentDigest != r.Digest || out.TransactionHash != signed.TransactionHash || (out.Status != "submission_unknown" && out.Status != "acknowledged") {
		return out, ErrIntent
	}
	if _, err = validateAuthorization(ctx, tx, r, spec, body, out.AuthorizationDigest, out.IntentDigest, out.CheckSequence, "settlement-submit-v1"); err != nil {
		return out, err
	}
	return out, nil
}

// Submit commits the unknown outcome before exactly one network attempt.
// Every retry returns the durable record, including unknown outcomes, without sending.
func (s Store) Submit(ctx context.Context, rpc SubmissionRPC, scope WorkScope, key, expectedHash string) (Submission, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID || rpc == nil {
		return Submission{}, ErrIntent
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Submission{}, err
	}
	defer tx.Rollback(ctx)
	spec, err := loadWorkForIntent(ctx, tx, scope, key)
	if err != nil {
		return Submission{}, err
	}
	r, err := readIntent(ctx, tx, scope, key, spec)
	if err != nil {
		return Submission{}, err
	}
	_, raw, err := readSign(ctx, tx, r, spec)
	if err != nil || raw == nil {
		return Submission{}, ErrIntent
	}
	signed, err := ValidateSigned(r, raw)
	if err != nil || signed.TransactionHash != expectedHash {
		return Submission{}, ErrIntent
	}
	old, err := readSubmission(ctx, tx, r, spec, signed)
	if err == nil {
		if err = tx.Commit(ctx); err != nil {
			return Submission{}, err
		}
		return old, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Submission{}, err
	}
	// Reuse all fresh fixed-intent checks; the saved signing authorization alone
	// is never permission to submit. No signer is invoked here.
	auth, err := s.authorizeIntent(ctx, tx, rpc, spec, r, "settlement-submit-v1")
	if err != nil {
		return Submission{}, err
	}
	body, err := json.Marshal(auth)
	if err != nil || len(body) > 1<<20 {
		return Submission{}, ErrIntent
	}
	sum := sha256.Sum256(body)
	out := Submission{JobKey: key, IntentDigest: r.Digest, TransactionHash: signed.TransactionHash, CheckSequence: auth.CheckSequence, AuthorizationDigest: hex.EncodeToString(sum[:]), Status: "submission_unknown"}
	_, err = tx.Exec(ctx, `INSERT INTO tickergarden.settlement_submissions(job_key,intent_digest,transaction_hash,check_sequence,authorization_digest,status,authorization_payload) VALUES($1,$2,$3,$4,$5,$6,$7)`, key, r.Digest, signed.TransactionHash, auth.CheckSequence, out.AuthorizationDigest, out.Status, body)
	if err != nil {
		return Submission{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Submission{}, err
	}
	if ctx.Err() != nil || time.Now().Unix() >= auth.NotAfter {
		return out, nil
	}
	sendCtx, stop := context.WithDeadline(ctx, time.Unix(auth.NotAfter, 0))
	defer stop()
	hash, err := rpc.SendRawTransaction(sendCtx, raw)
	if err != nil || hash != out.TransactionHash {
		return out, nil
	}
	tag, err := s.Pool.Exec(ctx, `UPDATE tickergarden.settlement_submissions SET status='acknowledged' WHERE job_key=$1 AND intent_digest=$2 AND transaction_hash=$3 AND authorization_digest=$4 AND status='submission_unknown'`, key, r.Digest, out.TransactionHash, out.AuthorizationDigest)
	if err != nil || tag.RowsAffected() != 1 {
		return out, nil
	}
	out.Status = "acknowledged"
	return out, nil
}

// Submission is an audit read. Acknowledgement is not inclusion or success.
func (s Store) Submission(ctx context.Context, scope WorkScope, key string) (Submission, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID {
		return Submission{}, ErrIntent
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Submission{}, err
	}
	defer tx.Rollback(ctx)
	spec, err := loadWorkForIntent(ctx, tx, scope, key)
	if err != nil {
		return Submission{}, err
	}
	r, err := readIntent(ctx, tx, scope, key, spec)
	if err != nil {
		return Submission{}, err
	}
	_, raw, err := readSign(ctx, tx, r, spec)
	if err != nil || raw == nil {
		return Submission{}, ErrIntent
	}
	signed, err := ValidateSigned(r, raw)
	if err != nil {
		return Submission{}, err
	}
	out, err := readSubmission(ctx, tx, r, spec, signed)
	if err != nil {
		return Submission{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Submission{}, err
	}
	return out, nil
}
