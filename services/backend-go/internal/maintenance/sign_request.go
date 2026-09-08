package maintenance

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
)

type SignResult struct {
	Status      string             `json:"status"`
	JobKey      string             `json:"jobKey"`
	Transaction *SignedTransaction `json:"transaction,omitempty"`
}

// Sign commits an unknown request before invoking the signer once. A retry never
// invokes it again, even if the signer timed out or the process lost its result.
func (s Store) Sign(ctx context.Context, signer Signer, key, digest, owner, token string, generation int64) (SignResult, error) {
	r := SignResult{Status: "signing_unknown", JobKey: key}
	if s.Pool == nil || signer == nil || !validLeaseInput(key, owner, token, 10) || !leaseHash.MatchString(digest) || generation < 1 {
		return r, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return r, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = s.lockLeaseJob(ctx, tx, key); e != nil {
		return r, e
	}
	reservation, e := reservationIn(ctx, tx, key)
	if e != nil || validateReservation(ctx, tx, reservation) != nil || reservation.Generation != generation {
		return r, ErrUnavailable
	}
	in, e := intentIn(ctx, tx, key)
	if e != nil || in.Digest != digest || validateIntent(ctx, tx, reservation, in) != nil {
		return r, ErrUnavailable
	}
	l, e := latestLease(ctx, tx, key)
	if e != nil || l.Generation != generation || l.Owner != owner || l.Token != token {
		return r, ErrLeaseLost
	}
	// An already persisted signed transaction can be inspected after lease expiry.
	signed, e := signedIn(ctx, tx, key, in)
	if e == nil {
		if tx.Commit(ctx) != nil {
			return r, ErrUnavailable
		}
		return SignResult{Status: "signed_stored", JobKey: key, Transaction: &signed}, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return r, ErrUnavailable
	}
	var previousDigest string
	var previousGeneration int64
	var raw []byte
	e = tx.QueryRow(ctx, `SELECT intent_digest,generation,raw_transaction FROM tickergarden.maintenance_sign_requests WHERE job_key=$1`, key).Scan(&previousDigest, &previousGeneration, &raw)
	existing := e == nil
	if existing && (previousDigest != digest || previousGeneration != generation) {
		return r, ErrUnavailable
	}
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return r, ErrUnavailable
	}
	if existing && raw == nil {
		if tx.Commit(ctx) != nil {
			return r, ErrUnavailable
		}
		return r, nil
	}
	now, e := leaseNow(ctx, tx)
	if e != nil {
		return r, ErrUnavailable
	}
	if !existing && (l.Released || !l.ExpiresAt.After(now)) {
		return r, ErrLeaseLost
	}
	if !existing {
		if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_sign_requests(job_key,intent_digest,generation) VALUES($1,$2,$3)`, key, digest, generation); e != nil {
			return r, ErrUnavailable
		}
	}
	if tx.Commit(ctx) != nil {
		return r, ErrUnavailable
	}
	if !existing {
		raw, e = signer.Sign(ctx, in)
		if e != nil {
			return r, nil
		}
		if _, e = ValidateSigned(in, raw); e != nil {
			return r, nil
		}
		// Save valid returned bytes even when the lease expired during signing. They
		// remain recoverable evidence, not renewed permission to attach or broadcast.
		tag, e := s.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_sign_requests SET raw_transaction=$3 WHERE job_key=$1 AND intent_digest=$2 AND raw_transaction IS NULL`, key, digest, raw)
		if e != nil || tag.RowsAffected() != 1 {
			return r, ErrUnavailable
		}
	}
	signed, e = ValidateSigned(in, raw)
	if e != nil {
		return r, ErrUnavailable
	}
	attached, e := s.AttachSigned(ctx, key, digest, owner, token, generation, raw)
	if e != nil {
		if errors.Is(e, ErrLeaseLost) {
			signed.Status = "signed_available"
			return SignResult{Status: "signed_available", JobKey: key, Transaction: &signed}, nil
		}
		return r, e
	}
	return SignResult{Status: "signed_stored", JobKey: key, Transaction: &attached}, nil
}
