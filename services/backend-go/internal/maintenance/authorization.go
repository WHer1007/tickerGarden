package maintenance

import (
	"context"
	"encoding/hex"
	"errors"
	"github.com/jackc/pgx/v5"
	"reflect"
	"strconv"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"time"
)

type AuthorizationRecovery struct {
	JobKey           string    `json:"jobKey"`
	RecoveryID       string    `json:"recoveryId"`
	IntentDigest     string    `json:"intentDigest"`
	SimulationDigest string    `json:"simulationDigest"`
	ExpiresAt        time.Time `json:"expiresAt"`
}

// RecoverAuthorization explicitly reactivates the original fence for one fixed
// intent. Released leases and unknown signer results cannot be revived. The
// operation neither signs nor changes the nonce/intent or submitted transaction.
func (s Store) RecoverAuthorization(ctx context.Context, rpc IntentObserver, p deployment.MaintenancePreview, digest, owner, token string, generation int64, recoveryID string) (AuthorizationRecovery, error) {
	bad := AuthorizationRecovery{}
	if s.Pool == nil || rpc == nil || !validLeaseInput(p.Key, owner, token, 10) || generation < 1 || !validLeaseInput(p.Key, owner, recoveryID, 10) || !leaseHash.MatchString(digest) || deployment.ValidateMaintenancePreview(p) != nil || p.ChainID != s.ChainID {
		return bad, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return bad, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = s.lockLeaseJob(ctx, tx, p.Key); e != nil {
		return bad, e
	}
	r, e := reservationIn(ctx, tx, p.Key)
	if e != nil || r.Generation != generation || validateReservation(ctx, tx, r) != nil {
		return bad, ErrUnavailable
	}
	in, e := intentIn(ctx, tx, p.Key)
	if e != nil || in.Digest != digest || validateIntent(ctx, tx, r, in) != nil {
		return bad, ErrUnavailable
	}
	l, e := latestLease(ctx, tx, p.Key)
	if e != nil || l.Owner != owner || l.Token != token || l.Generation != generation {
		return bad, ErrLeaseLost
	}
	var old AuthorizationRecovery
	var oldGeneration int64
	old.JobKey = p.Key
	old.RecoveryID = recoveryID
	e = tx.QueryRow(ctx, `SELECT generation,intent_digest,simulation_digest,expires_at FROM tickergarden.maintenance_authorization_recoveries WHERE job_key=$1 AND recovery_id=$2`, p.Key, recoveryID).Scan(&oldGeneration, &old.IntentDigest, &old.SimulationDigest, &old.ExpiresAt)
	if e == nil {
		if oldGeneration != generation || old.IntentDigest != digest {
			return bad, ErrUnavailable
		}
		if tx.Commit(ctx) != nil {
			return bad, ErrUnavailable
		}
		return old, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return bad, ErrUnavailable
	}
	if l.Released {
		return bad, ErrLeaseLost
	}
	var submitted bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.maintenance_submissions WHERE job_key=$1)`, p.Key).Scan(&submitted); e != nil || submitted {
		return bad, ErrUnavailable
	}
	var requestDigest string
	var requestGeneration int64
	var raw []byte
	e = tx.QueryRow(ctx, `SELECT intent_digest,generation,raw_transaction FROM tickergarden.maintenance_sign_requests WHERE job_key=$1`, p.Key).Scan(&requestDigest, &requestGeneration, &raw)
	if e == nil {
		if requestDigest != digest || requestGeneration != generation {
			return bad, ErrUnavailable
		}
		if raw == nil {
			saved, se := signedIn(ctx, tx, p.Key, in)
			if se != nil {
				return bad, ErrUnavailable
			}
			raw, e = hex.DecodeString(saved.RawTransaction[2:])
			if e != nil {
				return bad, ErrUnavailable
			}
		}
		if _, e = ValidateSigned(in, raw); e != nil {
			return bad, ErrUnavailable
		}
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return bad, ErrUnavailable
	}
	now, e := leaseNow(ctx, tx)
	if e != nil {
		return bad, ErrUnavailable
	}
	if l.ExpiresAt.After(now) {
		return bad, errors.New("authorization is still active")
	}
	if p.From != r.Sender || p.GenesisHash != r.GenesisHash || p.To != in.Intent.Call.To || p.Data != in.Intent.Call.Data {
		return bad, ErrUnavailable
	}
	timestamp, e := chainrpc.Quantity(p.BlockTimestamp)
	if e != nil || timestamp > uint64(now.Unix()+5) || now.Unix()-int64(timestamp) > 120 {
		return bad, ErrUnavailable
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != r.ChainID {
		return bad, ErrUnavailable
	}
	g, e := rpc.Header(ctx, "0x0")
	if e != nil || g.Hash != r.GenesisHash {
		return bad, ErrUnavailable
	}
	pending, e := rpc.PendingNonce(ctx, r.Sender)
	nonce, ne := strconv.ParseUint(r.Nonce, 10, 63)
	if e != nil || ne != nil || pending > nonce {
		return bad, ErrUnavailable
	}
	result, e := rpc.SimulateIntentAt(ctx, in.Intent.Call, p.BlockHash)
	if e != nil {
		return bad, ErrUnavailable
	}
	values, e := deployment.DecodeMaintenanceReturn(p.Request, result)
	if e != nil || !reflect.DeepEqual(values, p.ReturnValues) {
		return bad, ErrUnavailable
	}
	block, e := rpc.Header(ctx, p.BlockNumber)
	if e != nil || block.Hash != p.BlockHash || block.Timestamp != p.BlockTimestamp {
		return bad, ErrUnavailable
	}
	now, e = leaseNow(ctx, tx)
	if e != nil || now.Unix()-int64(timestamp) > 120 {
		return bad, ErrUnavailable
	}
	rec, e := s.recordIn(ctx, tx, p)
	if e != nil {
		return bad, e
	}
	expires := now.Add(time.Duration(l.TTLSeconds) * time.Second)
	_, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=$3 WHERE job_key=$1 AND generation=$2`, p.Key, generation, expires)
	if e != nil {
		return bad, ErrUnavailable
	}
	l.ExpiresAt = expires
	if e = leaseEvent(ctx, tx, l, "renewed"); e != nil {
		return bad, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_authorization_recoveries(job_key,recovery_id,generation,intent_digest,simulation_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6)`, p.Key, recoveryID, generation, digest, rec.Digest, expires)
	if e != nil || tx.Commit(ctx) != nil {
		return bad, ErrUnavailable
	}
	return AuthorizationRecovery{JobKey: p.Key, RecoveryID: recoveryID, IntentDigest: digest, SimulationDigest: rec.Digest, ExpiresAt: expires}, nil
}
