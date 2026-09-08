package holderledger

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
)

var ErrCheckpointAudit = errors.New("holder checkpoint history audit unavailable")

type CheckpointAudit struct {
	ScopeDigest          string          `json:"scopeDigest"`
	Revisions            int64           `json:"revisions"`
	Start                chainrpc.Header `json:"start"`
	Head                 chainrpc.Header `json:"head"`
	AuthenticatedSeed    bool            `json:"authenticatedSeed"`
	CheckpointChainValid bool            `json:"checkpointChainValid"`
	RawRootsReverified   bool            `json:"rawRootsReverified"`
	EvidenceReplayValid  bool            `json:"evidenceReplayValid"`
	EvidenceDigest       string          `json:"evidenceDigest"`
	HistoryVerified      bool            `json:"historyVerified"`
	PublicationEligible  bool            `json:"publicationEligible"`
}

// AuditHistory streams every immutable checkpoint and its retained evidence
// from the authenticated seed through the current head inside one repeatable-read
// snapshot. It re-verifies raw transaction and receipt roots and replays every
// captured call trace without contacting an RPC provider.
func (s CheckpointStore) AuditHistory(ctx context.Context, scope CheckpointScope) (CheckpointAudit, *Ledger, error) {
	fail := func() (CheckpointAudit, *Ledger, error) { return CheckpointAudit{}, nil, ErrCheckpointAudit }
	key, err := scopeKey(scope)
	if err != nil || s.Pool == nil {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	var headRevision int64
	if tx.QueryRow(ctx, `SELECT revision FROM tickergarden.holder_replay_heads WHERE scope_digest=$1`, key).Scan(&headRevision) != nil || headRevision < 0 {
		return fail()
	}
	rows, err := tx.Query(ctx, `SELECT c.revision,c.digest,c.payload,e.evidence_digest,e.payload FROM tickergarden.holder_replay_checkpoints c LEFT JOIN tickergarden.holder_replay_evidence e USING(scope_digest,revision) WHERE c.scope_digest=$1 AND c.revision<=$2 ORDER BY c.revision`, key, headRevision)
	if err != nil {
		return fail()
	}
	defer rows.Close()
	digest := sha256.New()
	digest.Write([]byte("tickergarden-holder-checkpoint-audit-v1\n"))
	var prior StoredCheckpoint
	var priorDigest string
	var latest *Ledger
	var start, head chainrpc.Header
	count := int64(0)
	for rows.Next() {
		var revision int64
		var storedDigest string
		var raw []byte
		var evidenceDigest *string
		var evidenceRaw []byte
		if rows.Scan(&revision, &storedDigest, &raw, &evidenceDigest, &evidenceRaw) != nil || revision != count || revision > headRevision || len(raw) > 5<<20 || checkpointDigest(raw) != storedDigest {
			return fail()
		}
		var stored StoredCheckpoint
		if json.Unmarshal(raw, &stored) != nil || stored.Revision != revision {
			return fail()
		}
		canonical, marshalErr := json.Marshal(stored)
		if marshalErr != nil || !bytes.Equal(raw, canonical) {
			return fail()
		}
		ledger, validateErr := validateStored(stored, scope)
		if validateErr != nil {
			return fail()
		}
		if revision == 0 {
			if stored.Seed == nil || evidenceDigest == nil || len(evidenceRaw) == 0 {
				return fail()
			}
			bundle, bundleErr := decodeStoredEvidence(evidenceRaw, *evidenceDigest)
			if bundleErr != nil || bundle.Kind != "seed" || bundle.Seed == nil {
				return fail()
			}
			seedLedger, seedReport, canonicalSeed, seedDigest, seedErr := verifySeedEvidence(ctx, *bundle.Seed)
			if seedErr != nil || seedReport != *stored.Seed || seedDigest != "sha256:"+checkpointDigest(canonicalSeed) {
				return fail()
			}
			seedState, seedErr := EncodeCheckpoint(seedLedger)
			if seedErr != nil || !bytes.Equal(seedState, stored.State) {
				return fail()
			}
			start = stored.Block
		} else {
			priorHeight, priorErr := prior.Block.Height()
			height, heightErr := stored.Block.Height()
			if priorErr != nil || heightErr != nil || height != priorHeight+1 || stored.Block.ParentHash != prior.Block.Hash || stored.ParentDigest != priorDigest || !sameSeed(stored.Seed, prior.Seed) {
				return fail()
			}
			if evidenceDigest == nil || len(evidenceRaw) == 0 || *evidenceDigest != "sha256:"+checkpointDigest(evidenceRaw) {
				return fail()
			}
			bundle, bundleErr := decodeStoredEvidence(evidenceRaw, *evidenceDigest)
			if bundleErr != nil || bundle.Kind != "replay" || bundle.Replay == nil {
				return fail()
			}
			evidence := *bundle.Replay
			if evidence.Parent != prior.Block || evidence.Block != stored.Block || evidence.Config != scope.Config {
				return fail()
			}
			canonicalEvidence, validatedDigest, evidenceErr := validateReplayEvidence(evidence, true)
			if evidenceErr != nil || validatedDigest != *evidenceDigest || !bytes.Equal(canonicalEvidence, evidenceRaw) {
				return fail()
			}
			replayed, replay, replayErr := replayStoredEvidence(latest, evidence)
			if replayErr != nil || stored.Replay == nil || replay != *stored.Replay {
				return fail()
			}
			replayedState, replayErr := EncodeCheckpoint(replayed)
			if replayErr != nil || !bytes.Equal(replayedState, stored.State) {
				return fail()
			}
		}
		if evidenceDigest == nil {
			return fail()
		}
		digest.Write([]byte(fmt.Sprintf("%d:%s:%s\n", revision, storedDigest, *evidenceDigest)))
		prior, priorDigest, latest, head = stored, storedDigest, ledger, stored.Block
		count++
	}
	if rows.Err() != nil || count != headRevision+1 || latest == nil || prior.Revision != headRevision || ctx.Err() != nil {
		return fail()
	}
	if err = tx.Commit(ctx); err != nil {
		return fail()
	}
	return CheckpointAudit{ScopeDigest: key, Revisions: count, Start: start, Head: head, AuthenticatedSeed: true, CheckpointChainValid: true, RawRootsReverified: true, EvidenceReplayValid: true, EvidenceDigest: "sha256:" + hex.EncodeToString(digest.Sum(nil))}, latest, nil
}
