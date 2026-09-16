package maintenance

import (
	"bytes"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
)

// ImportSignature records recovered output for an existing signing request. It
// may preserve evidence after expiry/release, but never renews authorization,
// attaches a signature, allocates a nonce, invokes a signer or broadcasts.
func (s Store) ImportSignature(ctx context.Context, key, digest, expectedHash, owner, token string, generation int64, raw []byte) (SignResult, error) {
	bad := SignResult{}
	if s.Pool == nil || !validLeaseInput(key, owner, token, 10) || !leaseHash.MatchString(digest) || !leaseHash.MatchString(expectedHash) || generation < 1 || len(raw) == 0 || len(raw) > 16384 {
		return bad, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return bad, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = s.lockLeaseJob(ctx, tx, key); e != nil {
		return bad, e
	}
	r, e := reservationIn(ctx, tx, key)
	if e != nil || r.Generation != generation || validateReservation(ctx, tx, r) != nil {
		return bad, ErrUnavailable
	}
	in, e := intentIn(ctx, tx, key)
	if e != nil || in.Digest != digest || validateIntent(ctx, tx, r, in) != nil {
		return bad, ErrUnavailable
	}
	l, e := latestLease(ctx, tx, key)
	if e != nil || l.Generation != generation || l.Owner != owner || l.Token != token {
		return bad, ErrLeaseLost
	}
	var requestDigest string
	var requestGeneration int64
	var previous []byte
	if e = tx.QueryRow(ctx, `SELECT intent_digest,generation,raw_transaction FROM tickergarden.maintenance_sign_requests WHERE job_key=$1 FOR UPDATE`, key).Scan(&requestDigest, &requestGeneration, &previous); e != nil || requestDigest != digest || requestGeneration != generation {
		return bad, ErrUnavailable
	}
	signed, e := ValidateSigned(in, raw)
	if e != nil || signed.TransactionHash != expectedHash {
		return bad, ErrUnavailable
	}
	if previous != nil && !bytes.Equal(previous, raw) {
		return bad, errors.New("signer result bytes already fixed")
	}
	status := "signed_available"
	attached, e := signedIn(ctx, tx, key, in)
	if e == nil {
		if attached.TransactionHash != expectedHash || attached.RawTransaction != signed.RawTransaction {
			return bad, ErrUnavailable
		}
		status = "signed_stored"
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return bad, ErrUnavailable
	}
	if previous == nil {
		if _, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_sign_requests SET raw_transaction=$2 WHERE job_key=$1`, key, raw); e != nil {
			return bad, ErrUnavailable
		}
	}
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_signature_imports(job_key,intent_digest,transaction_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, key, digest, expectedHash); e != nil {
		return bad, ErrUnavailable
	}
	var storedDigest, storedHash string
	if e = tx.QueryRow(ctx, `SELECT intent_digest,transaction_hash FROM tickergarden.maintenance_signature_imports WHERE job_key=$1`, key).Scan(&storedDigest, &storedHash); e != nil || storedDigest != digest || storedHash != expectedHash {
		return bad, ErrUnavailable
	}
	if tx.Commit(ctx) != nil {
		return bad, ErrUnavailable
	}
	signed.Status = status
	return SignResult{Status: status, JobKey: key, Transaction: &signed}, nil
}
