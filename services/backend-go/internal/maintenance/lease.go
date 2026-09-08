package maintenance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
)

var ErrLeaseBusy = errors.New("maintenance task is leased")
var ErrLeaseLost = errors.New("maintenance lease expired, released or superseded")
var ownerPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)
var leaseHash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

type Lease struct {
	JobKey     string    `json:"jobKey"`
	Generation int64     `json:"generation"`
	Owner      string    `json:"owner"`
	Token      string    `json:"token"`
	TTLSeconds int       `json:"ttlSeconds"`
	ExpiresAt  time.Time `json:"expiresAt"`
	Released   bool      `json:"released"`
}

func validLeaseInput(key, owner, token string, ttl int) bool {
	return leaseHash.MatchString(key) && ownerPattern.MatchString(owner) && leaseHash.MatchString(token) && token != "0x"+strings.Repeat("0", 64) && ttl >= 10 && ttl <= 300
}

// lockLeaseJob uses the same row lock as record writes, validating a saved
// simulation before issuing a preparation lease. No chain freshness is inferred.
func (s Store) lockLeaseJob(ctx context.Context, tx pgx.Tx, key string) error {
	var body, raw []byte
	var digest, intent, simDigest string
	var chain uint64
	e := tx.QueryRow(ctx, `SELECT chain_id,identity_payload,identity_digest,intent_digest FROM tickergarden.maintenance_jobs WHERE job_key=$1 FOR UPDATE`, key).Scan(&chain, &body, &digest, &intent)
	if e != nil || chain != s.ChainID || len(body) > 4096 || deployment.Hash(body) != digest {
		return ErrUnavailable
	}
	e = tx.QueryRow(ctx, `SELECT payload,digest FROM tickergarden.maintenance_simulations WHERE job_key=$1 ORDER BY sequence DESC LIMIT 1`, key).Scan(&raw, &simDigest)
	var p deployment.MaintenancePreview
	if e != nil || len(raw) > 16384 || deployment.Hash(raw) != simDigest || json.Unmarshal(raw, &p) != nil || deployment.ValidateMaintenancePreview(p) != nil || p.Key != key || p.ChainID != chain {
		return ErrUnavailable
	}
	wantIntent, wantBody, wantDigest := envelopes(p)
	if wantIntent != intent || wantDigest != digest || !bytes.Equal(body, wantBody) {
		return ErrUnavailable
	}
	return nil
}
func latestLease(ctx context.Context, tx pgx.Tx, key string) (Lease, error) {
	var l Lease
	l.JobKey = key
	e := tx.QueryRow(ctx, `SELECT generation,owner,token,ttl_seconds,expires_at,released FROM tickergarden.maintenance_leases WHERE job_key=$1 ORDER BY generation DESC LIMIT 1`, key).Scan(&l.Generation, &l.Owner, &l.Token, &l.TTLSeconds, &l.ExpiresAt, &l.Released)
	return l, e
}
func leaseNow(ctx context.Context, tx pgx.Tx) (time.Time, error) {
	var now time.Time
	e := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now)
	return now, e
}
func leaseEvent(ctx context.Context, tx pgx.Tx, l Lease, action string) error {
	_, e := tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_lease_events(job_key,generation,action,expires_at) VALUES($1,$2,$3,$4)`, l.JobKey, l.Generation, action, l.ExpiresAt)
	return e
}

// AcquireLease is idempotent only while the same token's lease is live. Expired
// tokens can never acquire again; a new acquisition token advances the fence.
func (s Store) AcquireLease(ctx context.Context, key, owner, token string, ttl int) (Lease, error) {
	if s.Pool == nil {
		return Lease{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Lease{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	result, e := s.acquireLeaseIn(ctx, tx, key, owner, token, ttl)
	if e != nil {
		return Lease{}, e
	}
	if tx.Commit(ctx) != nil {
		return Lease{}, ErrUnavailable
	}
	return result, nil
}

func (s Store) acquireLeaseIn(ctx context.Context, tx pgx.Tx, key, owner, token string, ttl int) (Lease, error) {
	if s.Pool == nil || !validLeaseInput(key, owner, token, ttl) {
		return Lease{}, ErrUnavailable
	}
	var e error
	if e = s.lockLeaseJob(ctx, tx, key); e != nil {
		return Lease{}, e
	}
	l, e := latestLease(ctx, tx, key)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return Lease{}, ErrUnavailable
	}
	now, e := leaseNow(ctx, tx)
	if e != nil {
		return Lease{}, ErrUnavailable
	}
	if l.Token == token {
		if l.Owner != owner || l.TTLSeconds != ttl || l.Released || !l.ExpiresAt.After(now) {
			return Lease{}, ErrLeaseLost
		}
		return l, nil
	}
	var reserved bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.maintenance_nonce_reservations WHERE job_key=$1)`, key).Scan(&reserved); e != nil {
		return Lease{}, ErrUnavailable
	}
	if reserved {
		return Lease{}, ErrNonceReserved
	}
	var used bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.maintenance_leases WHERE job_key=$1 AND token=$2)`, key, token).Scan(&used)
	if e != nil {
		return Lease{}, ErrUnavailable
	}
	if used {
		return Lease{}, ErrLeaseLost
	}
	if l.Generation > 0 && !l.Released && l.ExpiresAt.After(now) {
		return Lease{}, ErrLeaseBusy
	}
	if l.Generation == math.MaxInt64 {
		return Lease{}, ErrUnavailable
	}
	l = Lease{JobKey: key, Generation: l.Generation + 1, Owner: owner, Token: token, TTLSeconds: ttl, ExpiresAt: now.Add(time.Duration(ttl) * time.Second)}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_leases(job_key,generation,owner,token,ttl_seconds,expires_at) VALUES($1,$2,$3,$4,$5,$6)`, key, l.Generation, owner, token, ttl, l.ExpiresAt)
	if e != nil || leaseEvent(ctx, tx, l, "acquired") != nil {
		return Lease{}, ErrUnavailable
	}
	return l, nil
}

// ChangeLease fences every write by owner, token and generation. Renewal cannot
// revive an expired lease. Releasing a matching released lease is idempotent.
func (s Store) ChangeLease(ctx context.Context, key, owner, token string, generation int64, release bool) (Lease, error) {
	if s.Pool == nil || !validLeaseInput(key, owner, token, 10) || generation < 1 {
		return Lease{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Lease{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = s.lockLeaseJob(ctx, tx, key); e != nil {
		return Lease{}, e
	}
	l, e := latestLease(ctx, tx, key)
	if e != nil {
		return Lease{}, ErrLeaseLost
	}
	if l.Generation != generation || l.Token != token || l.Owner != owner {
		return Lease{}, ErrLeaseLost
	}
	if release && l.Released {
		if tx.Commit(ctx) != nil {
			return Lease{}, ErrUnavailable
		}
		return l, nil
	}
	now, e := leaseNow(ctx, tx)
	if e != nil {
		return Lease{}, ErrUnavailable
	}
	if l.Released || !l.ExpiresAt.After(now) {
		return Lease{}, ErrLeaseLost
	}
	action := "renewed"
	if release {
		l.Released = true
		action = "released"
	} else {
		l.ExpiresAt = now.Add(time.Duration(l.TTLSeconds) * time.Second)
	}
	_, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=$3,released=$4 WHERE job_key=$1 AND generation=$2`, key, generation, l.ExpiresAt, l.Released)
	if e != nil || leaseEvent(ctx, tx, l, action) != nil || tx.Commit(ctx) != nil {
		return Lease{}, ErrUnavailable
	}
	return l, nil
}
