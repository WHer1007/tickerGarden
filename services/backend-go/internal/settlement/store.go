package settlement

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrStore = errors.New("settlement audit record unavailable or inconsistent")

type Store struct {
	Pool    *pgxpool.Pool
	ChainID uint64
}
type CheckRecord struct {
	Sequence int64           `json:"sequence"`
	Digest   string          `json:"digest"`
	Status   string          `json:"status"`
	Payload  json.RawMessage `json:"payload"`
}

// Record accepts only the opaque result of VerifyConversion. This append-only
// audit table is deliberately separate from transaction execution state.
func (s Store) Record(ctx context.Context, v VerifiedConversion) (CheckRecord, error) {
	if s.Pool == nil || s.ChainID != v.chainID || len(v.payload) == 0 || len(v.manifest) == 0 {
		return CheckRecord{}, ErrStore
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return CheckRecord{}, ErrStore
	}
	defer tx.Rollback(ctx)
	r, err := s.recordIn(ctx, tx, v)
	if err != nil {
		return CheckRecord{}, err
	}
	if tx.Commit(ctx) != nil {
		return CheckRecord{}, ErrStore
	}
	return r, nil
}

func (s Store) recordIn(ctx context.Context, tx pgx.Tx, v VerifiedConversion) (CheckRecord, error) {
	if s.ChainID != v.chainID || len(v.payload) == 0 || len(v.manifest) == 0 {
		return CheckRecord{}, ErrStore
	}
	raw, err := json.Marshal(struct {
		Version  string          `json:"version"`
		Manifest json.RawMessage `json:"manifest"`
		Result   json.RawMessage `json:"result"`
	}{"tickergarden-conversion-evidence-v1", v.manifest, v.payload})
	if err != nil || len(raw)+1 > 1<<20 {
		return CheckRecord{}, ErrStore
	}
	raw = append(raw, '\n')
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])
	_, err = tx.Exec(ctx, `INSERT INTO tickergarden.settlement_checks(chain_id,genesis_hash,market_id,request_digest,block_hash,digest,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(digest) DO NOTHING`, s.ChainID, v.genesis, v.market, v.request, v.block, digest, raw)
	if err != nil {
		return CheckRecord{}, ErrStore
	}
	var r CheckRecord
	var chain uint64
	var genesis, market, request, block string
	err = tx.QueryRow(ctx, `SELECT sequence,digest,status,payload,chain_id,genesis_hash,market_id,request_digest,block_hash FROM tickergarden.settlement_checks WHERE digest=$1`, digest).Scan(&r.Sequence, &r.Digest, &r.Status, &r.Payload, &chain, &genesis, &market, &request, &block)
	if err != nil || chain != v.chainID || genesis != v.genesis || market != v.market || request != v.request || block != v.block || r.Status != "checked_unsigned" || !bytes.Equal(r.Payload, raw) {
		return CheckRecord{}, ErrStore
	}
	return r, nil
}

// History is bounded, scoped by chain/genesis/market and ordered by sequence.
// Old observations are returned for audit only, without re-authorizing them.
func (s Store) History(ctx context.Context, genesis, market string, after int64) ([]CheckRecord, error) {
	if s.Pool == nil || (s.ChainID != 4663 && s.ChainID != 46630 && s.ChainID != 421614) || !hashPattern.MatchString(genesis) || !hashPattern.MatchString(market) || after < 0 {
		return nil, ErrStore
	}
	rows, err := s.Pool.Query(ctx, `SELECT sequence,digest,status,payload,request_digest,block_hash FROM tickergarden.settlement_checks WHERE chain_id=$1 AND genesis_hash=$2 AND market_id=$3 AND sequence>$4 ORDER BY sequence LIMIT 100`, s.ChainID, genesis, market, after)
	if err != nil {
		return nil, ErrStore
	}
	defer rows.Close()
	out := []CheckRecord{}
	for rows.Next() {
		var r CheckRecord
		var request, block string
		if rows.Scan(&r.Sequence, &r.Digest, &r.Status, &r.Payload, &request, &block) != nil {
			return nil, ErrStore
		}
		sum := sha256.Sum256(r.Payload)
		if hex.EncodeToString(sum[:]) != r.Digest || r.Status != "checked_unsigned" || !json.Valid(r.Payload) {
			return nil, ErrStore
		}
		var envelope struct {
			Version string
			Result  struct{ Preview ConversionPreview }
		}
		if json.Unmarshal(r.Payload, &envelope) != nil || envelope.Version != "tickergarden-conversion-evidence-v1" {
			return nil, ErrStore
		}
		p := envelope.Result.Preview
		if p.Candidate.State.ChainID != s.ChainID || p.Candidate.State.GenesisHash != genesis || p.Candidate.State.MarketID != market || p.Candidate.Request.RequestDigest != request || p.Candidate.State.Block.Hash != block {
			return nil, ErrStore
		}
		out = append(out, r)
	}
	if rows.Err() != nil {
		return nil, ErrStore
	}
	return out, nil
}
