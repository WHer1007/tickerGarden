// Package reconciliation verifies persisted evidence without authorizing publication.
package reconciliation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/journal"
	"tickergarden/backend/internal/principal"
	"tickergarden/backend/internal/projector"
)

var ErrEvidence = errors.New("reconciliation evidence unavailable or inconsistent")
var hashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

type Result struct {
	ChainID          uint64                   `json:"chainId"`
	BlockHash        string                   `json:"blockHash"`
	BlockNumber      string                   `json:"blockNumber"`
	ProjectorVersion string                   `json:"projectorVersion"`
	EvidenceVerified bool                     `json:"evidenceVerified"`
	Coverage         RangeCoverage            `json:"coverage"`
	Report           principal.Reconciliation `json:"report"`
}

// Inspect recomputes the current report from its immutable event checkpoint and
// hash-bound observation batch, then compares both stored representations.
// This verifies stored evidence, not RPC truth or complete event history.
func Inspect(ctx context.Context, pool *pgxpool.Pool, chain uint64, hash string) (Result, error) {
	fail := func() (Result, error) { return Result{}, ErrEvidence }
	if pool == nil || (chain != 4663 && chain != 46630 && chain != 421614) || !hashPattern.MatchString(hash) {
		return fail()
	}
	tx, e := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return fail()
	}
	defer tx.Rollback(ctx)
	var locked bool
	if e = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock_shared($1)`, int64(730000000+chain)).Scan(&locked); e != nil || !locked {
		return fail()
	}
	var raw, checkpoint, observations []byte
	var digest, checkpointDigest, observationDigest, manifest, version string
	var height, start uint64
	var expected, completed, failed, missing int
	e = tx.QueryRow(ctx, `SELECT r.payload,r.digest,r.block_number,r.expected_count,r.completed_count,r.failed_count,r.missing_count,c.payload,c.digest,b.payload,b.digest,p.manifest_hash,p.projector_version,p.start_block
 FROM tickergarden.canonical_reconciliation_runs r
 JOIN tickergarden.principal_checkpoints c USING(chain_id,block_hash)
 JOIN tickergarden.projection_observation_batches b USING(chain_id,block_hash)
 JOIN tickergarden.projection_checkpoints p USING(chain_id)
 WHERE r.chain_id=$1 AND r.block_hash=$2 AND r.scope='vault-principal-v3'`, chain, hash).Scan(&raw, &digest, &height, &expected, &completed, &failed, &missing, &checkpoint, &checkpointDigest, &observations, &observationDigest, &manifest, &version, &start)
	if e != nil || version != projector.Version || !validDigest(raw, digest) || !validDigest(checkpoint, checkpointDigest) || deployment.Hash(observations) != observationDigest {
		return fail()
	}
	var cp struct {
		Chain     uint64          `json:"chain"`
		BlockHash string          `json:"blockHash"`
		Manifest  string          `json:"manifest"`
		Version   string          `json:"version"`
		Start     uint64          `json:"start"`
		Ledger    json.RawMessage `json:"ledger"`
		Inputs    *uint64         `json:"inputs"`
	}
	if json.Unmarshal(checkpoint, &cp) != nil || cp.Chain != chain || cp.BlockHash != hash || cp.Manifest != manifest || cp.Version != version || cp.Start != start || cp.Inputs == nil {
		return fail()
	}
	ledger, e := principal.Restore(cp.Ledger)
	if e != nil {
		return fail()
	}
	var batch deployment.ObservationBatch
	if json.Unmarshal(observations, &batch) != nil || batch.Scope != projector.ObservationScope || batch.ChainID != chain || batch.BlockHash != hash || batch.BlockNumber != "0x"+strconv.FormatUint(height, 16) || batch.Expected != len(batch.Observations) {
		return fail()
	}
	report := ledger.Reconcile(batch.Observations)
	rebuilt, e := json.Marshal(report)
	if e != nil || !bytes.Equal(raw, rebuilt) || expected != report.Expected || completed != report.Completed || failed != report.Failed || missing != report.Missing {
		return fail()
	}
	rows, e := tx.Query(ctx, `SELECT ordinal,kind,probe_key,field,expected_value,actual_value,status,comparison FROM tickergarden.reconciliation_probes WHERE chain_id=$1 AND block_hash=$2 AND scope=$3 ORDER BY ordinal`, chain, hash, report.Scope)
	if e != nil {
		return fail()
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var ordinal int
		var probe principal.Probe
		if e = rows.Scan(&ordinal, &probe.Kind, &probe.Key, &probe.Field, &probe.Expected, &probe.Actual, &probe.Status, &probe.Comparison); e != nil || count >= len(report.Probes) || ordinal != count {
			return fail()
		}
		got, _ := json.Marshal(probe)
		want, _ := json.Marshal(report.Probes[count])
		if !bytes.Equal(got, want) {
			return fail()
		}
		count++
	}
	if rows.Err() != nil || count != report.Expected {
		return fail()
	}
	coverage, e := verifyRange(ctx, tx, chain, start, height, hash)
	if e != nil {
		return fail()
	}
	var genesis string
	if tx.QueryRow(ctx, `SELECT genesis_hash FROM tickergarden.chain_journal WHERE chain_id=$1`, chain).Scan(&genesis) != nil {
		return fail()
	}
	roots, e := journal.VerifyStoredReceiptHistory(ctx, tx, chain, start, height, genesis, hash)
	if e != nil {
		return fail()
	}
	coverage.CompleteReceiptsVerified = true
	coverage.ReceiptRootsVerified = roots
	replayed, e := verifyReplay(ctx, tx, chain, start, height, *cp.Inputs, cp.Ledger)
	if e != nil {
		return fail()
	}
	coverage.EventReplayVerified = true
	coverage.ReplayedInputs = strconv.FormatUint(replayed, 10)
	if tx.Commit(ctx) != nil {
		return fail()
	}
	return Result{ChainID: chain, BlockHash: hash, BlockNumber: strconv.FormatUint(height, 10), ProjectorVersion: version, EvidenceVerified: true, Coverage: coverage, Report: report}, nil
}
func validDigest(raw []byte, digest string) bool {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]) == digest
}
