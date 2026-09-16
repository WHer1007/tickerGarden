package maintenance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"strconv"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/txaccount"
)

var ErrNonceReserved = errors.New("maintenance task has a nonce reservation; inspect existing intent before recovery")

type NonceObserver interface {
	ChainID(context.Context) (uint64, error)
	Header(context.Context, string) (chainrpc.Header, error)
	PendingNonce(context.Context, string) (uint64, error)
}
type Reservation struct {
	JobKey           string `json:"jobKey"`
	Generation       int64  `json:"generation"`
	ChainID          uint64 `json:"chainId"`
	GenesisHash      string `json:"genesisHash"`
	Sender           string `json:"sender"`
	Nonce            string `json:"nonce"`
	SimulationDigest string `json:"simulationDigest"`
	Status           string `json:"status"`
}

func reservationIn(ctx context.Context, tx pgx.Tx, key string) (Reservation, error) {
	r := Reservation{JobKey: key, Status: "nonce_reserved"}
	e := tx.QueryRow(ctx, `SELECT generation,chain_id,genesis_hash,sender,nonce::text,simulation_digest FROM tickergarden.maintenance_nonce_reservations WHERE job_key=$1`, key).Scan(&r.Generation, &r.ChainID, &r.GenesisHash, &r.Sender, &r.Nonce, &r.SimulationDigest)
	return r, e
}
func (s Store) ReserveNonce(ctx context.Context, rpc NonceObserver, p deployment.MaintenancePreview, owner, token string, generation int64) (Reservation, error) {
	if s.Pool == nil {
		return Reservation{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Reservation{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	result, e := s.reserveNonceIn(ctx, tx, rpc, p, owner, token, generation)
	if e != nil {
		return Reservation{}, e
	}
	if tx.Commit(ctx) != nil {
		return Reservation{}, ErrUnavailable
	}
	return result, nil
}

func (s Store) reserveNonceIn(ctx context.Context, tx pgx.Tx, rpc NonceObserver, p deployment.MaintenancePreview, owner, token string, generation int64) (Reservation, error) {
	if s.Pool == nil || rpc == nil || !validLeaseInput(p.Key, owner, token, 10) || generation < 1 || p.ChainID != s.ChainID || deployment.ValidateMaintenancePreview(p) != nil {
		return Reservation{}, ErrUnavailable
	}
	raw, e := json.Marshal(p)
	if e != nil {
		return Reservation{}, ErrUnavailable
	}
	digest := deployment.Hash(raw)
	if e = s.lockLeaseJob(ctx, tx, p.Key); e != nil {
		return Reservation{}, e
	}
	l, e := latestLease(ctx, tx, p.Key)
	if e != nil {
		return Reservation{}, ErrLeaseLost
	}
	now, e := leaseNow(ctx, tx)
	if e != nil {
		return Reservation{}, ErrUnavailable
	}
	if l.Owner != owner || l.Token != token || l.Generation != generation || l.Released || !l.ExpiresAt.After(now) {
		return Reservation{}, ErrLeaseLost
	}
	existing, e := reservationIn(ctx, tx, p.Key)
	if e == nil {
		if existing.Generation != generation || existing.ChainID != p.ChainID || existing.Sender != p.From || existing.GenesisHash != p.GenesisHash {
			return Reservation{}, ErrUnavailable
		}
		if validateReservation(ctx, tx, existing) != nil {
			return Reservation{}, ErrUnavailable
		}
		return existing, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Reservation{}, ErrUnavailable
	}
	var saved []byte
	e = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, p.Key, digest).Scan(&saved)
	if e != nil || !bytes.Equal(saved, raw) {
		return Reservation{}, ErrUnavailable
	}
	timestamp, e := chainrpc.Quantity(p.BlockTimestamp)
	if e != nil || timestamp > uint64(now.Unix()+5) || now.Unix()-int64(timestamp) > 120 {
		return Reservation{}, ErrUnavailable
	}
	if e = txaccount.Claim(ctx, tx, p.ChainID, p.GenesisHash, p.From, "maintenance"); e != nil {
		return Reservation{}, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_nonce_accounts(chain_id,genesis_hash,sender,next_nonce) VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING`, p.ChainID, p.GenesisHash, p.From)
	if e != nil {
		return Reservation{}, ErrUnavailable
	}
	var next uint64
	e = tx.QueryRow(ctx, `SELECT next_nonce FROM tickergarden.maintenance_nonce_accounts WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 FOR UPDATE`, p.ChainID, p.GenesisHash, p.From).Scan(&next)
	if e != nil {
		return Reservation{}, ErrUnavailable
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != p.ChainID {
		return Reservation{}, ErrUnavailable
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil || genesis.Hash != p.GenesisHash {
		return Reservation{}, ErrUnavailable
	}
	pending, e := rpc.PendingNonce(ctx, p.From)
	if e != nil {
		return Reservation{}, ErrUnavailable
	}
	block, e := rpc.Header(ctx, p.BlockNumber)
	if e != nil || block.Hash != p.BlockHash || block.Timestamp != p.BlockTimestamp {
		return Reservation{}, ErrUnavailable
	}
	// Recheck the lease after waiting for the account lock and the network.
	now, e = leaseNow(ctx, tx)
	if e != nil || !l.ExpiresAt.After(now) || now.Unix()-int64(timestamp) > 120 {
		return Reservation{}, ErrLeaseLost
	}
	if pending > next {
		next = pending
	}
	if next >= math.MaxInt64 {
		return Reservation{}, ErrUnavailable
	}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_nonce_reservations(job_key,generation,chain_id,genesis_hash,sender,nonce,simulation_digest) VALUES($1,$2,$3,$4,$5,$6,$7)`, p.Key, generation, p.ChainID, p.GenesisHash, p.From, next, digest)
	if e != nil {
		return Reservation{}, ErrUnavailable
	}
	_, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_nonce_accounts SET next_nonce=$4 WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3`, p.ChainID, p.GenesisHash, p.From, next+1)
	if e != nil {
		return Reservation{}, ErrUnavailable
	}
	return Reservation{JobKey: p.Key, Generation: generation, ChainID: p.ChainID, GenesisHash: p.GenesisHash, Sender: p.From, Nonce: strconv.FormatUint(next, 10), SimulationDigest: digest, Status: "nonce_reserved"}, nil
}

// Reservation survives lease expiry; reading it never authorizes a new signature.
func (s Store) Reservation(ctx context.Context, key string) (Reservation, error) {
	if s.Pool == nil || !leaseHash.MatchString(key) {
		return Reservation{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Reservation{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = s.lockLeaseJob(ctx, tx, key); e != nil {
		return Reservation{}, e
	}
	r, e := reservationIn(ctx, tx, key)
	if e != nil || r.ChainID != s.ChainID {
		return Reservation{}, ErrUnavailable
	}
	if validateReservation(ctx, tx, r) != nil {
		return Reservation{}, ErrUnavailable
	}
	if tx.Commit(ctx) != nil {
		return Reservation{}, ErrUnavailable
	}
	return r, nil
}

func validateReservation(ctx context.Context, tx pgx.Tx, r Reservation) error {
	var raw []byte
	e := tx.QueryRow(ctx, `SELECT payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, r.JobKey, r.SimulationDigest).Scan(&raw)
	var p deployment.MaintenancePreview
	if e != nil || deployment.Hash(raw) != r.SimulationDigest || json.Unmarshal(raw, &p) != nil || deployment.ValidateMaintenancePreview(p) != nil || p.Key != r.JobKey || p.ChainID != r.ChainID || p.From != r.Sender || p.GenesisHash != r.GenesisHash {
		return ErrUnavailable
	}
	return nil
}
