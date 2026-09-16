package readmodel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"reflect"
	"strconv"
	"tickergarden/backend/internal/deployment"
	"time"
)

type ObservationStore struct {
	EmitterManifest                           *deployment.Manifest
	Pool                                      *pgxpool.Pool
	ChainID                                   uint64
	GenesisHash, ManifestHash, Version, Scope string
	StartBlock                                uint64
}

// LoadCandidateBatch verifies the current observation payload and its row mirror
// in a single read-only snapshot. This is local persistence/provenance evidence,
// not complete receipt-history verification or financial reconciliation.
func (s *ObservationStore) LoadCandidateBatch(ctx context.Context) (deployment.ObservationBatch, error) {
	fail := func() (deployment.ObservationBatch, error) {
		return deployment.ObservationBatch{}, errors.New("candidate observation batch unavailable")
	}
	if s.Pool == nil || !candidateHash.MatchString(s.GenesisHash) || !candidateHash.MatchString(s.ManifestHash) || s.Version == "" || s.Scope == "" {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	batch, e := s.loadCandidateBatch(ctx, tx)
	if e != nil {
		return fail()
	}
	if tx.Commit(ctx) != nil {
		return fail()
	}
	return batch, nil
}

func (s *ObservationStore) loadCandidateBatch(ctx context.Context, tx pgx.Tx) (deployment.ObservationBatch, error) {
	fail := func() (deployment.ObservationBatch, error) {
		return deployment.ObservationBatch{}, errors.New("candidate observation batch unavailable")
	}
	var payload []byte
	var hash, digest string
	var height uint64
	var count int
	e := tx.QueryRow(ctx, `SELECT o.payload,o.digest,p.tip_hash,p.tip_number,o.completed_count
 FROM tickergarden.projection_checkpoints p
 JOIN tickergarden.chain_journal j USING(chain_id)
 JOIN tickergarden.discovery_checkpoints d USING(chain_id)
 JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.tip_hash AND b.number=p.tip_number
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=d.chain_id AND tip.hash=d.tip_hash AND tip.number=d.tip_number
 JOIN tickergarden.projection_observation_batches o ON o.chain_id=p.chain_id AND o.block_hash=p.tip_hash
 WHERE p.chain_id=$1 AND j.genesis_hash=$2 AND p.manifest_hash=$3 AND d.manifest_hash=$3
 AND p.projector_version=$4 AND o.scope=$5 AND p.start_block=$6 AND d.start_block=$6
 AND b.canonical AND b.events_verified AND tip.canonical AND tip.events_verified
 AND p.tip_number>=p.start_block AND p.tip_number<=d.tip_number AND d.tip_number<=j.finalized_number
 AND j.updated_at>=clock_timestamp()-interval '120 seconds' AND j.updated_at<=clock_timestamp()+interval '5 seconds'
 AND o.expected_count=o.completed_count AND o.completed_count<=100000 AND octet_length(o.payload)<=16777216`, s.ChainID, s.GenesisHash, s.ManifestHash, s.Version, s.Scope, s.StartBlock).Scan(&payload, &digest, &hash, &height, &count)
	if e != nil || deployment.Hash(payload) != digest {
		return fail()
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if uniqueJSON(decoder, 0) != nil {
		return fail()
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return fail()
	}
	var batch deployment.ObservationBatch
	decoder = json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if decoder.Decode(&batch) != nil || batch.ChainID != s.ChainID || batch.BlockHash != hash || batch.BlockNumber != "0x"+strconv.FormatUint(height, 16) || batch.Scope != s.Scope || batch.Expected != count || len(batch.Observations) != count {
		return fail()
	}
	expected := map[string]map[string]any{}
	for _, o := range batch.Observations {
		key := o.Kind + ":" + o.Key
		if o.Value == nil || expected[key] != nil {
			return fail()
		}
		expected[key] = o.Value
	}
	rows, e := tx.Query(ctx, `SELECT kind,observation_key,value FROM tickergarden.projection_block_observations WHERE chain_id=$1 AND block_hash=$2 LIMIT 100001`, s.ChainID, hash)
	if e != nil {
		return fail()
	}
	defer rows.Close()
	seen := 0
	size := 0
	for rows.Next() {
		var kind, key string
		var raw []byte
		if rows.Scan(&kind, &key, &raw) != nil {
			return fail()
		}
		seen++
		size += len(raw)
		if seen > count || size > MaxSnapshotBytes {
			return fail()
		}
		var value map[string]any
		d := json.NewDecoder(bytes.NewReader(raw))
		d.UseNumber()
		if d.Decode(&value) != nil || !reflect.DeepEqual(value, expected[kind+":"+key]) {
			return fail()
		}
		delete(expected, kind+":"+key)
	}
	if rows.Err() != nil || seen != count || len(expected) != 0 {
		return fail()
	}
	rows.Close()
	return batch, nil
}
