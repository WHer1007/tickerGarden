package readmodel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

var ErrRevision = errors.New("snapshot expired; restart this query from current health")

const MaxAge = 120 * time.Second

// Store publishes trusted producer output after schema and journal provenance
// checks. It does not independently compute/reconcile the balances in that output.
type Store struct {
	Pool            *pgxpool.Pool
	ChainID         uint64
	validationMu    sync.Mutex
	validated       map[validationKey]bool
	validationOrder []validationKey
}
type Reader interface {
	Load(context.Context, string) (Snapshot, error)
}

func (s *Store) Publish(ctx context.Context, data []byte, verifiedAt time.Time) error {
	return s.publish(ctx, data, nil, verifiedAt)
}

// PublishVerified atomically stores the snapshot and the complete producer
// evidence that authorized it. A retry is idempotent only when both payloads
// have the same immutable digests.
func (s *Store) PublishVerified(ctx context.Context, data, evidenceRaw []byte, verifiedAt time.Time) error {
	return s.publish(ctx, data, evidenceRaw, verifiedAt)
}

func (s *Store) publish(ctx context.Context, data, evidenceRaw []byte, verifiedAt time.Time) error {
	snap, e := Parse(data, s.ChainID)
	if e != nil {
		return e
	}
	var evidence *PublicationEvidence
	var evidenceDigest string
	if evidenceRaw != nil {
		parsed, evidenceErr := parsePublicationEvidence(evidenceRaw, snap)
		if evidenceErr != nil {
			return evidenceErr
		}
		evidence = &parsed
		evidenceDigest = deployment.Hash(evidenceRaw)
	}
	now := time.Now()
	if verifiedAt.Before(now.Add(-MaxAge)) || verifiedAt.After(now.Add(5*time.Second)) {
		return errors.New("producer verification timestamp is stale or in the future")
	}
	payload, e := json.Marshal(snap)
	if e != nil {
		return errors.New("cannot serialize snapshot")
	}
	sum := sha256.Sum256(payload)
	digest := hex.EncodeToString(sum[:])
	if s.Pool == nil {
		return errors.New("snapshot publication requires PostgreSQL")
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return errors.New("cannot begin publication")
	}
	defer tx.Rollback(context.Background())
	// Same lease as the raw journal: provenance cannot change while publishing.
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(730000000+s.ChainID)); e != nil {
		return errors.New("cannot lock publication")
	}
	var oldDigest string
	var oldEvidenceDigest *string
	if evidence == nil {
		e = tx.QueryRow(ctx, `SELECT digest FROM tickergarden.read_snapshots WHERE chain_id=$1 AND revision=$2`, s.ChainID, snap.Sync.Revision).Scan(&oldDigest)
	} else {
		e = tx.QueryRow(ctx, `SELECT s.digest,e.evidence_digest FROM tickergarden.read_snapshots s LEFT JOIN tickergarden.read_snapshot_evidence e USING(chain_id,revision) WHERE s.chain_id=$1 AND s.revision=$2`, s.ChainID, snap.Sync.Revision).Scan(&oldDigest, &oldEvidenceDigest)
	}
	if e == nil {
		if oldDigest != digest || (evidence != nil && (oldEvidenceDigest == nil || *oldEvidenceDigest != evidenceDigest)) {
			return errors.New("immutable revision content conflict")
		}
		return nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return errors.New("cannot read publication history; run migrations first")
	}
	n, _ := Height(*snap.Sync.BlockNumber)
	head, _ := Height(*snap.Sync.HeadBlockNumber)
	var final *uint64
	var observed time.Time
	var newest *uint64
	e = tx.QueryRow(ctx, `SELECT finalized_number,updated_at,(SELECT max(block_number) FROM tickergarden.read_snapshots WHERE chain_id=$1) FROM tickergarden.chain_journal WHERE chain_id=$1`, s.ChainID).Scan(&final, &observed, &newest)
	if e != nil || final == nil || n > *final || time.Since(observed) > MaxAge {
		return errors.New("journal is missing, stale or not finalized through snapshot")
	}
	var missingReceipts bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND number<=$2 AND NOT receipts_verified)`, s.ChainID, n).Scan(&missingReceipts)
	if e != nil || missingReceipts {
		return errors.New("journal receipt verification is incomplete")
	}
	if newest != nil && n <= *newest {
		return errors.New("publication must advance the finalized revision")
	}
	checkBlock := func(number uint64, hash string) error {
		var ok bool
		e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND hash=$3 AND canonical AND events_verified)`, s.ChainID, number, hash).Scan(&ok)
		if e != nil || !ok {
			return errors.New("snapshot references a noncanonical or missing block")
		}
		return nil
	}
	if e = checkBlock(n, *snap.Sync.BlockHash); e != nil {
		return e
	}
	if e = checkBlock(head, *snap.Sync.HeadBlockHash); e != nil {
		return e
	}
	sources := []SourceBlock{}
	for _, m := range snap.Markets {
		sources = append(sources, m.Source)
	}
	for _, c := range snap.Configs {
		sources = append(sources, c.Source)
	}
	for _, p := range snap.Positions {
		sources = append(sources, p.Source)
	}
	if snap.Accounts != nil {
		for _, a := range *snap.Accounts {
			sources = append(sources, a.Source)
		}
	}
	checked := map[SourceBlock]bool{}
	for _, source := range sources {
		if checked[source] {
			continue
		}
		checked[source] = true
		number, _ := Height(source.BlockNumber)
		if e = checkBlock(number, source.BlockHash); e != nil {
			return e
		}
		var hash, index string
		e = tx.QueryRow(ctx, `SELECT payload->>'transactionHash',payload->>'transactionIndex' FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2 AND log_index=$3`, s.ChainID, source.BlockHash, source.LogIndex).Scan(&hash, &index)
		txIndex, parseErr := chainrpc.Quantity(index)
		if e != nil || parseErr != nil || txIndex != source.TransactionIndex || !strings.EqualFold(hash, source.TransactionHash) {
			return errors.New("entity source does not match indexed log provenance")
		}
	}
	if e = verifyIdentities(ctx, tx, snap); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.read_snapshots(chain_id,revision,block_number,block_hash,digest,payload,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, s.ChainID, snap.Sync.Revision, n, *snap.Sync.BlockHash, digest, payload, verifiedAt)
	if e != nil {
		return errors.New("cannot persist read snapshot")
	}
	if evidence != nil {
		_, e = tx.Exec(ctx, `INSERT INTO tickergarden.read_snapshot_evidence(chain_id,revision,evidence_digest,candidate_digest,manifest_hash,block_number,block_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, s.ChainID, snap.Sync.Revision, evidenceDigest, evidence.CandidateDigest, evidence.ManifestHash, n, *snap.Sync.BlockHash, evidenceRaw)
		if e != nil {
			return errors.New("cannot persist publication evidence")
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return errors.New("publication commit failed")
	}
	return nil
}

// One SQL statement selects both the requested version and the current safety
// state. Concurrent publication cannot mix a page with another revision's sync.
func (s *Store) Load(ctx context.Context, revision string) (Snapshot, error) {
	empty := Empty(s.ChainID)
	if s.Pool == nil {
		if revision != "" {
			return empty, ErrRevision
		}
		return empty, nil
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return empty, errors.New("read snapshot transaction unavailable")
	}
	defer tx.Rollback(context.Background())
	var payload []byte
	var digest string
	var published, current, journal time.Time
	var canonical bool
	e := tx.QueryRow(ctx, `WITH recent AS (
 SELECT * FROM tickergarden.read_snapshots WHERE chain_id=$1 ORDER BY block_number DESC LIMIT 32
 ), latest AS (SELECT * FROM recent ORDER BY block_number DESC LIMIT 1)
 SELECT r.payload,r.digest,r.verified_at,c.verified_at,j.updated_at,
 COALESCE(rb.canonical AND cb.canonical AND j.finalized_number>=c.block_number AND NOT EXISTS(SELECT 1 FROM tickergarden.chain_blocks pending WHERE pending.chain_id=c.chain_id AND pending.canonical AND pending.number<=c.block_number AND NOT pending.receipts_verified),false)
 FROM recent r CROSS JOIN latest c JOIN tickergarden.chain_journal j ON j.chain_id=c.chain_id
 LEFT JOIN tickergarden.chain_blocks rb ON rb.chain_id=r.chain_id AND rb.hash=r.block_hash
 LEFT JOIN tickergarden.chain_blocks cb ON cb.chain_id=c.chain_id AND cb.hash=c.block_hash
 WHERE ($2='' AND r.revision=c.revision) OR r.revision=$2`, s.ChainID, revision).Scan(&payload, &digest, &published, &current, &journal, &canonical)
	if errors.Is(e, pgx.ErrNoRows) {
		if revision != "" {
			return empty, ErrRevision
		}
		return empty, nil
	}
	if e != nil {
		return empty, errors.New("read snapshot storage unavailable")
	}
	snap, e := s.parsePersisted(payload, digest)
	if e != nil {
		return empty, errors.New("persisted snapshot invalid")
	}
	if e = verifyIdentities(ctx, tx, snap); e != nil {
		canonical = false
	}
	now := time.Now()
	fresh := func(t time.Time) bool { return !t.Before(now.Add(-MaxAge)) && !t.After(now.Add(5*time.Second)) }
	available := canonical && fresh(current) && fresh(journal)
	// Historical versions are usable only while the latest publisher and journal
	// remain healthy. Their own age does not defeat consistent paginated queries.
	if !available {
		if revision != "" {
			return empty, ErrRevision
		}
		snap.Sync.Status = "unavailable"
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, errors.New("read snapshot transaction failed")
	}
	return snap, nil
}
