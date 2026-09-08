package treasury

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
	"time"
)

// ProcessJobOnce computes a candidate only. Failure is durably rescheduled;
// exhausted leases/attempts require operator inspection, never a zero root.
func ProcessJobOnce(ctx context.Context, q JobQueue, journal *pgxpool.Pool, rpc deployment.BindingObserver, manifest deployment.Manifest) (Job, error) {
	j, err := q.Claim(ctx, manifest)
	if err != nil {
		return Job{}, err
	}
	work, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	err = processLeasedJob(work, q, journal, rpc, j)
	if err != nil {
		cleanup, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer stop()
		if e := q.Fail(cleanup, j); e != nil {
			return j, e
		}
		return j, errors.New("Treasury job processing failed; retry or dead state recorded")
	}
	return q.Status(ctx, j.ID)
}
func processLeasedJob(ctx context.Context, q JobQueue, journal *pgxpool.Pool, rpc deployment.BindingObserver, j Job) error {
	// Candidate evidence must use the same finalized snapshot as the journal.
	// A newer RPC finalized head may not yet be ingested; publication separately
	// rechecks the live request so this never authorizes stale calldata.
	var height uint64
	var savedHash string
	err := journal.QueryRow(ctx, `SELECT j.finalized_number,j.finalized_hash FROM tickergarden.chain_journal j JOIN tickergarden.chain_blocks b ON b.chain_id=j.chain_id AND b.number=j.finalized_number AND b.hash=j.finalized_hash AND b.canonical AND b.receipts_verified WHERE j.chain_id=$1`, j.Spec.Manifest.ChainID).Scan(&height, &savedHash)
	if err != nil {
		return errors.New("candidate finalized journal snapshot unavailable")
	}
	final, err := rpc.Header(ctx, "finalized")
	if err != nil {
		return err
	}
	finalHeight, err := final.Height()
	if err != nil || height > finalHeight {
		return errors.New("candidate journal finality ahead of RPC")
	}
	block, err := rpc.Header(ctx, fmt.Sprintf("0x%x", height))
	if err != nil {
		return err
	}
	observedHeight, err := block.Height()
	if err != nil || observedHeight != height || block.Hash != savedHash {
		return errors.New("candidate finalized journal hash differs from RPC")
	}
	observed, err := deployment.ObserveTreasuryRequest(ctx, rpc, j.Spec.Manifest, block, j.Spec.Input.MarketID, j.Spec.Input.EpochID)
	if err != nil {
		return err
	}
	if err = MatchRequest(j.Spec.Input, observed); err != nil {
		return err
	}
	input, evidence, err := LoadJournalInput(ctx, journal, j.Spec.Input)
	if err != nil {
		return err
	}
	evidence.RootRequestVerified = true
	output, err := Generate(input)
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	id, err := SaveCandidate(ctx, q.Pool, Candidate{Input: input, Dataset: output, Journal: evidence, Request: observed})
	if err != nil {
		return err
	}
	// Save and completion are separate: crash leaves an immutable candidate;
	// retry is harmless and never submits a transaction.
	return q.Complete(ctx, j, id)
}
