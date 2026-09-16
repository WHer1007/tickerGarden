// Package maintenance coordinates authenticated maintenance preparation, submission,
// recovery and verification. A successful simulation alone is never completion.
package maintenance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

var ErrUnavailable = errors.New("maintenance record unavailable or inconsistent")

type Store struct {
	Pool    *pgxpool.Pool
	ChainID uint64
}
type Record struct {
	Sequence int64                         `json:"sequence"`
	Digest   string                        `json:"digest"`
	Preview  deployment.MaintenancePreview `json:"preview"`
}
type identity struct {
	ChainID     uint64                        `json:"chainId"`
	GenesisHash string                        `json:"genesisHash"`
	From        string                        `json:"from"`
	Request     deployment.MaintenanceRequest `json:"request"`
	Target      string                        `json:"target,omitempty"`
	Module      string                        `json:"module,omitempty"`
	Data        string                        `json:"data,omitempty"`
}

func envelopes(p deployment.MaintenancePreview) (intent string, body []byte, digest string) {
	v := identity{ChainID: p.ChainID, GenesisHash: p.GenesisHash, From: p.From, Request: p.Request}
	raw, _ := json.Marshal(v)
	intent = deployment.Hash(raw)
	v.Target, v.Module, v.Data = p.To, p.Module, p.Data
	body, _ = json.Marshal(v)
	digest = deployment.Hash(body)
	return
}
func (s Store) Record(ctx context.Context, p deployment.MaintenancePreview) (Record, error) {
	if s.Pool == nil || p.ChainID != s.ChainID || deployment.ValidateMaintenancePreview(p) != nil {
		return Record{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Record{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	result, e := s.recordIn(ctx, tx, p)
	if e != nil || tx.Commit(ctx) != nil {
		return Record{}, ErrUnavailable
	}
	return result, nil
}

func (s Store) recordIn(ctx context.Context, tx pgx.Tx, p deployment.MaintenancePreview) (Record, error) {
	if p.ChainID != s.ChainID || deployment.ValidateMaintenancePreview(p) != nil {
		return Record{}, ErrUnavailable
	}
	raw, e := json.Marshal(p)
	if e != nil || len(raw) > 16384 {
		return Record{}, ErrUnavailable
	}
	intent, body, digest := envelopes(p)
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_jobs(job_key,intent_digest,chain_id,identity_payload,identity_digest) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, p.Key, intent, p.ChainID, body, digest)
	if e != nil {
		return Record{}, ErrUnavailable
	}
	var key, storedDigest string
	var stored []byte
	var chain uint64
	// Serialize records of this intent and reject retargeting the same trigger.
	e = tx.QueryRow(ctx, `SELECT job_key,chain_id,identity_payload,identity_digest FROM tickergarden.maintenance_jobs WHERE intent_digest=$1 FOR UPDATE`, intent).Scan(&key, &chain, &stored, &storedDigest)
	if e != nil || key != p.Key || chain != s.ChainID || storedDigest != digest || !bytes.Equal(stored, body) {
		return Record{}, ErrUnavailable
	}
	simulationDigest := deployment.Hash(raw)
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_simulations(job_key,payload,digest) VALUES($1,$2,$3) ON CONFLICT(job_key,digest) DO NOTHING`, p.Key, raw, simulationDigest)
	if e != nil {
		return Record{}, ErrUnavailable
	}
	var seq int64
	var saved []byte
	e = tx.QueryRow(ctx, `SELECT sequence,payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, p.Key, simulationDigest).Scan(&seq, &saved)
	if e != nil || !bytes.Equal(saved, raw) {
		return Record{}, ErrUnavailable
	}
	return Record{Sequence: seq, Digest: simulationDigest, Preview: p}, nil
}

// History returns a bounded ascending audit page. after is the last returned
// sequence, not an offset; records remain useful after the simulated block ages.
func (s Store) History(ctx context.Context, key string, after int64) ([]Record, error) {
	if s.Pool == nil || after < 0 || len(key) != 66 {
		return nil, ErrUnavailable
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	var chain uint64
	var body []byte
	var digest, intent string
	e = tx.QueryRow(ctx, `SELECT chain_id,identity_payload,identity_digest,intent_digest FROM tickergarden.maintenance_jobs WHERE job_key=$1`, key).Scan(&chain, &body, &digest, &intent)
	if e != nil || chain != s.ChainID || len(body) > 4096 || deployment.Hash(body) != digest {
		return nil, ErrUnavailable
	}
	rows, e := tx.Query(ctx, `SELECT sequence,payload,digest FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND sequence>$2 ORDER BY sequence LIMIT 100`, key, after)
	if e != nil {
		return nil, ErrUnavailable
	}
	defer rows.Close()
	out := []Record{}
	for rows.Next() {
		var r Record
		var raw []byte
		if rows.Scan(&r.Sequence, &raw, &r.Digest) != nil || len(raw) > 16384 || deployment.Hash(raw) != r.Digest || json.Unmarshal(raw, &r.Preview) != nil || deployment.ValidateMaintenancePreview(r.Preview) != nil || r.Preview.Key != key || r.Preview.ChainID != chain {
			return nil, ErrUnavailable
		}
		wantIntent, wantBody, wantDigest := envelopes(r.Preview)
		if wantIntent != intent || wantDigest != digest || !bytes.Equal(body, wantBody) {
			return nil, ErrUnavailable
		}
		out = append(out, r)
	}
	if rows.Err() != nil {
		return nil, ErrUnavailable
	}
	rows.Close()
	if tx.Commit(ctx) != nil {
		return nil, ErrUnavailable
	}
	return out, nil
}
