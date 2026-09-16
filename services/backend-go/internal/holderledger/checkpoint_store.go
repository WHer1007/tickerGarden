package holderledger

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
)

var digestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var replayDigestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

var ErrCheckpoint = errors.New("holder checkpoint unavailable, inconsistent or concurrently changed")

type CheckpointStore struct{ Pool *pgxpool.Pool }
type CheckpointScope struct {
	Config   ReconcileConfig `json:"config"`
	MarketID string          `json:"marketId"`
	Token    string          `json:"token"`
}
type StoredCheckpoint struct {
	Version             int
	Scope               CheckpointScope
	Revision            int64
	ParentDigest        string
	Block               chainrpc.Header
	State               json.RawMessage
	Seed                *AuthenticatedSeed
	Replay              *BlockReplay
	HistoryVerified     bool
	PublicationEligible bool
}

func checkpointDatabaseError(stage string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return fmt.Errorf("%w: %s (SQLSTATE %s, constraint %s)", ErrCheckpoint, stage, pgErr.Code, pgErr.ConstraintName)
	}
	return fmt.Errorf("%w: %s", ErrCheckpoint, stage)
}

func checkpointDigest(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func sameSeed(a, b *AuthenticatedSeed) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
func scopeKey(s CheckpointScope) (string, error) {
	c := s.Config
	if c.ChainID == 0 || c.ChainID > 1<<63-1 || !hash.MatchString(c.GenesisHash) || !hash.MatchString(c.TokenCodeHash) || !hash.MatchString(c.DistributorCodeHash) || !hash.MatchString(s.MarketID) || !address.MatchString(s.Token) || s.Token == zero || !address.MatchString(c.Quote) || c.Quote == s.Token || !address.MatchString(c.Binding.Distributor) || !address.MatchString(c.Binding.Vault) || c.Binding.Distributor == zero || c.Binding.Vault == zero || c.Binding.Distributor == c.Binding.Vault || c.MaxAccounts < 1 || c.MaxAccounts > 10000 {
		return "", ErrCheckpoint
	}
	b, _ := json.Marshal(s)
	return checkpointDigest(b), nil
}

// ScopeDigest exposes the canonical scope identity for cross-service evidence
// binding without exposing the database key construction details.
func ScopeDigest(s CheckpointScope) (string, error) { return scopeKey(s) }
func validateStored(v StoredCheckpoint, s CheckpointScope) (*Ledger, error) {
	if v.Version != 1 || v.Scope != s || v.Revision < 0 || v.HistoryVerified || v.PublicationEligible {
		return nil, ErrCheckpoint
	}
	ts, e := v.Block.Time()
	if e != nil {
		return nil, ErrCheckpoint
	}
	blockHeight, heightErr := v.Block.Height()
	if heightErr != nil || !hash.MatchString(v.Block.Hash) || !hash.MatchString(v.Block.ParentHash) {
		return nil, ErrCheckpoint
	}
	l, e := DecodeCheckpoint(v.State)
	if e != nil || l.Token != s.Token || l.MarketID != s.MarketID || l.UpdatedAt > ts || len(l.Accounts) > s.Config.MaxAccounts {
		return nil, ErrCheckpoint
	}
	if v.Seed != nil && (blockHeight == 0 || v.Seed.Block != v.Block || !hash.MatchString(v.Seed.RegistrationTx) || v.Seed.Transactions < 1 || v.Seed.Transactions > 16384 || v.Seed.Transfers < 1 || v.Seed.Accounts < 1 || v.Seed.Accounts > s.Config.MaxAccounts || !replayDigestPattern.MatchString(v.Seed.EvidenceDigest) || v.Seed.HistoryVerified || v.Seed.PublicationEligible) {
		return nil, ErrCheckpoint
	}
	if v.Revision == 0 {
		if v.ParentDigest != "" || v.Replay != nil {
			return nil, ErrCheckpoint
		}
	} else {
		if !digestPattern.MatchString(v.ParentDigest) || v.Replay == nil || v.Replay.Block != v.Block || v.Replay.HistoryVerified || v.Replay.PublicationEligible || !replayDigestPattern.MatchString(v.Replay.EvidenceDigest) {
			return nil, ErrCheckpoint
		}
	}
	return l, nil
}

// Initialize stores an explicitly provisional operator seed. No existing scope
// may be reset; a caller must read after an uncertain commit, never overwrite.
func (s CheckpointStore) Initialize(ctx context.Context, scope CheckpointScope, block chainrpc.Header, l *Ledger) error {
	return s.initialize(ctx, scope, block, l, nil, nil, "")
}

// InitializeAuthenticated persists the complete evidence summary returned by
// AuthenticatePristineSeed. It remains publication-ineligible until subsequent
// complete history replay and a separate publication gate are implemented.
func (s CheckpointStore) InitializeAuthenticated(ctx context.Context, scope CheckpointScope, block chainrpc.Header, l *Ledger, seed AuthenticatedSeed) error {
	return s.initialize(ctx, scope, block, l, &seed, nil, "")
}

// InitializeAuthenticatedEvidence additionally retains the raw transaction and
// receipt-root inputs plus every hash-pinned state read used by seed validation.
func (s CheckpointStore) InitializeAuthenticatedEvidence(ctx context.Context, scope CheckpointScope, block chainrpc.Header, l *Ledger, seed AuthenticatedSeed, evidence SeedEvidence) error {
	verified, report, _, _, e := verifySeedEvidence(ctx, evidence)
	if e != nil {
		return fmt.Errorf("%w: seed evidence verification", ErrCheckpoint)
	}
	if report != seed || evidence.Config.Scope != scope || evidence.Block != block {
		return fmt.Errorf("%w: seed evidence binding", ErrCheckpoint)
	}
	want, wantErr := EncodeCheckpoint(l)
	got, gotErr := EncodeCheckpoint(verified)
	if wantErr != nil || gotErr != nil || !bytes.Equal(want, got) {
		return fmt.Errorf("%w: seed state comparison", ErrCheckpoint)
	}
	evidenceRaw, evidenceDigest, e := encodeStoredEvidence(StoredEvidence{Version: 1, Kind: "seed", Seed: &evidence})
	if e != nil {
		return fmt.Errorf("%w: seed evidence encoding", ErrCheckpoint)
	}
	return s.initialize(ctx, scope, block, l, &seed, evidenceRaw, evidenceDigest)
}

func (s CheckpointStore) initialize(ctx context.Context, scope CheckpointScope, block chainrpc.Header, l *Ledger, seed *AuthenticatedSeed, evidenceRaw []byte, evidenceDigest string) error {
	key, e := scopeKey(scope)
	if e != nil || s.Pool == nil {
		return fmt.Errorf("%w: invalid scope or store", ErrCheckpoint)
	}
	state, e := EncodeCheckpoint(l)
	if e != nil {
		return fmt.Errorf("%w: checkpoint state encoding", ErrCheckpoint)
	}
	v := StoredCheckpoint{Version: 1, Scope: scope, Block: block, State: state, Seed: seed}
	if _, e = validateStored(v, scope); e != nil {
		return fmt.Errorf("%w: checkpoint state validation", ErrCheckpoint)
	}
	raw, _ := json.Marshal(v)
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return checkpointDatabaseError("begin transaction", e)
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.holder_replay_checkpoints(scope_digest,revision,digest,payload) VALUES($1,0,$2,$3)`, key, checkpointDigest(raw), raw); e != nil {
		return checkpointDatabaseError("insert checkpoint", e)
	}
	if len(evidenceRaw) > 0 {
		if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.holder_replay_evidence(scope_digest,revision,evidence_digest,payload) VALUES($1,0,$2,$3)`, key, evidenceDigest, evidenceRaw); e != nil {
			return checkpointDatabaseError("insert evidence", e)
		}
	}
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.holder_replay_heads(scope_digest,revision) VALUES($1,0)`, key); e != nil {
		return checkpointDatabaseError("insert head", e)
	}
	if e = tx.Commit(ctx); e != nil {
		return checkpointDatabaseError("commit transaction", e)
	}
	return nil
}
func (s CheckpointStore) Load(ctx context.Context, scope CheckpointScope) (StoredCheckpoint, *Ledger, string, error) {
	fail := func() (StoredCheckpoint, *Ledger, string, error) { return StoredCheckpoint{}, nil, "", ErrCheckpoint }
	key, e := scopeKey(scope)
	if e != nil || s.Pool == nil {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var raw []byte
	var digest string
	var rev int64
	e = s.Pool.QueryRow(ctx, `SELECT c.payload,c.digest,c.revision FROM tickergarden.holder_replay_heads h JOIN tickergarden.holder_replay_checkpoints c USING(scope_digest,revision) WHERE h.scope_digest=$1`, key).Scan(&raw, &digest, &rev)
	if e != nil || len(raw) > 5<<20 || checkpointDigest(raw) != digest {
		return fail()
	}
	var v StoredCheckpoint
	if json.Unmarshal(raw, &v) != nil || v.Revision != rev {
		return fail()
	}
	canonical, _ := json.Marshal(v)
	if !bytes.Equal(raw, canonical) {
		return fail()
	}
	l, e := validateStored(v, scope)
	if e != nil {
		return fail()
	}
	if rev > 0 {
		var parentRaw []byte
		var parentHash string
		if s.Pool.QueryRow(ctx, `SELECT payload,digest FROM tickergarden.holder_replay_checkpoints WHERE scope_digest=$1 AND revision=$2`, key, rev-1).Scan(&parentRaw, &parentHash) != nil || checkpointDigest(parentRaw) != parentHash || v.ParentDigest != parentHash {
			return fail()
		}
		var parent StoredCheckpoint
		if json.Unmarshal(parentRaw, &parent) != nil {
			return fail()
		}
		pn, pe := parent.Block.Height()
		n, ne := v.Block.Height()
		if pe != nil || ne != nil || pn >= 1<<63-1 || n != pn+1 || v.Block.ParentHash != parent.Block.Hash || parent.Revision != rev-1 || parent.Scope != scope || !sameSeed(parent.Seed, v.Seed) {
			return fail()
		}
	}
	return v, l, digest, nil
}

// Advance loads a private state, verifies/replays exactly the next block, then
// atomically appends evidence and moves the head using compare-and-swap. RPC work
// holds no DB lock. A failed/ambiguous commit must be reconciled by Load.
func (s CheckpointStore) Advance(ctx context.Context, rpc BlockReplayRPC, scope CheckpointScope, block chainrpc.Header) (BlockReplay, error) {
	prior, l, digest, e := s.Load(ctx, scope)
	if e != nil || prior.Revision == 1<<63-1 {
		return BlockReplay{}, ErrCheckpoint
	}
	capture := &replayCaptureRPC{BlockReplayRPC: rpc}
	report, e := l.ReplayNextBlock(ctx, capture, scope.Config, prior.Block, block)
	if e != nil {
		return BlockReplay{}, e
	}
	evidence, e := capture.evidence(prior.Block, block, scope.Config)
	if e != nil {
		return BlockReplay{}, e
	}
	if _, _, e = validateReplayEvidence(evidence, false); e != nil {
		return BlockReplay{}, e
	}
	evidenceRaw, evidenceDigest, e := encodeStoredEvidence(StoredEvidence{Version: 1, Kind: "replay", Replay: &evidence})
	if e != nil {
		return BlockReplay{}, e
	}
	state, e := EncodeCheckpoint(l)
	if e != nil {
		return BlockReplay{}, ErrCheckpoint
	}
	next := StoredCheckpoint{Version: 1, Scope: scope, Revision: prior.Revision + 1, ParentDigest: digest, Block: block, State: state, Seed: prior.Seed, Replay: &report}
	if _, e = validateStored(next, scope); e != nil {
		return BlockReplay{}, e
	}
	raw, _ := json.Marshal(next)
	key, _ := scopeKey(scope)
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return BlockReplay{}, ErrCheckpoint
	}
	defer tx.Rollback(ctx)
	var current string
	e = tx.QueryRow(ctx, `SELECT c.digest FROM tickergarden.holder_replay_heads h JOIN tickergarden.holder_replay_checkpoints c USING(scope_digest,revision) WHERE h.scope_digest=$1 AND h.revision=$2 FOR UPDATE OF h`, key, prior.Revision).Scan(&current)
	if e != nil || current != digest {
		return BlockReplay{}, ErrCheckpoint
	}
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.holder_replay_checkpoints(scope_digest,revision,digest,payload) VALUES($1,$2,$3,$4)`, key, next.Revision, checkpointDigest(raw), raw); e != nil {
		return BlockReplay{}, ErrCheckpoint
	}
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.holder_replay_evidence(scope_digest,revision,evidence_digest,payload) VALUES($1,$2,$3,$4)`, key, next.Revision, evidenceDigest, evidenceRaw); e != nil {
		return BlockReplay{}, ErrCheckpoint
	}
	result, e := tx.Exec(ctx, `UPDATE tickergarden.holder_replay_heads SET revision=$1 WHERE scope_digest=$2 AND revision=$3`, next.Revision, key, prior.Revision)
	if e != nil || result.RowsAffected() != 1 {
		return BlockReplay{}, ErrCheckpoint
	}
	if tx.Commit(ctx) != nil {
		return BlockReplay{}, ErrCheckpoint
	}
	return report, nil
}
