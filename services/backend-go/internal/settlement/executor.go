package settlement

import (
	"context"
	"errors"
)

// ExecutionRPC composes existing authenticated RPC boundaries. No reduced-trust
// simulation or alternate submission path is introduced by the executor.
type ExecutionRPC interface {
	SubmissionRPC
	ReceiptStateRPC
}
type ExecutionProgress struct {
	JobKey              string `json:"jobKey"`
	State               string `json:"state"`
	TransactionHash     string `json:"transactionHash,omitempty"`
	ReceiptStatus       string `json:"receiptStatus,omitempty"`
	EvidenceSequence    int64  `json:"evidenceSequence,omitempty"`
	AccountingVerified  bool   `json:"accountingVerified"`
	ReservationReleased bool   `json:"reservationReleased"`
}

// AdvanceExecution resumes one operator-selected checked job through the
// existing durable primitives. Unknown signing is never retried, unknown sends
// are only observed, and a successful receipt alone is never accounting proof.
// Finalized receipts release only maximum gas holds, never recycle nonces.
func (s Store) AdvanceExecution(ctx context.Context, rpc ExecutionRPC, signer Signer, scope WorkScope, key string, fees ExecutionPolicy) (ExecutionProgress, error) {
	if s.Pool == nil || rpc == nil || signer == nil || s.ChainID != scope.ChainID || !hashPattern.MatchString("0x"+key) {
		return ExecutionProgress{}, ErrIntent
	}
	steps := executionSteps{
		finalize: func(r ReceiptRecord) error { return s.releaseReservation(ctx, rpc, scope, key, r) },
		prepare:  func() error { _, _, e := s.PrepareIntent(ctx, rpc, scope, key, fees); return e },
		sign:     func() (SignResult, error) { return s.Sign(ctx, rpc, signer, scope, key, fees) },
		submit:   func(h string) (Submission, error) { return s.Submit(ctx, rpc, scope, key, h) },
		receipt:  func() (ReceiptRecord, error) { return s.ObserveReceipt(ctx, rpc, scope, key) },
		evidence: func(r ReceiptRecord) (int64, error) {
			prior, e := s.ExecutionEvidenceHistory(ctx, scope, key, 0)
			if e != nil {
				return 0, e
			}
			// History reads independently revalidate the stored original evidence. The
			// new receipt observation establishes current canonical/finalized identity.
			for _, v := range prior {
				if r.Observation.Receipt != nil && v.TransactionHash == r.Observation.TransactionHash && v.Block.Hash == r.Observation.Receipt.BlockHash && v.Block.Number == r.Observation.Receipt.BlockNumber {
					return v.Sequence, nil
				}
			}
			ev, e := s.RecordExecutionEvidence(ctx, rpc, scope, key)
			return ev.Sequence, e
		},
	}
	return advanceExecution(ctx, key, steps)
}

type executionSteps struct {
	finalize func(ReceiptRecord) error
	prepare  func() error
	sign     func() (SignResult, error)
	submit   func(string) (Submission, error)
	receipt  func() (ReceiptRecord, error)
	evidence func(ReceiptRecord) (int64, error)
}

func advanceExecution(ctx context.Context, key string, s executionSteps) (ExecutionProgress, error) {
	out := ExecutionProgress{JobKey: key, State: "preparing"}
	fail := func(e error) (ExecutionProgress, error) { return out, e }
	if e := ctx.Err(); e != nil {
		return fail(e)
	}
	if e := s.prepare(); e != nil {
		return fail(e)
	}
	out.State = "signing"
	signed, e := s.sign()
	if e != nil {
		return fail(e)
	}
	if signed.Status == "signing_unknown" && signed.Transaction == nil {
		out.State = "signing_reconciliation_required"
		return out, nil
	}
	if signed.Transaction == nil || signed.Status != "signed_stored" {
		return fail(ErrIntent)
	}
	out.TransactionHash = signed.Transaction.TransactionHash
	if !hashPattern.MatchString(out.TransactionHash) {
		return fail(ErrIntent)
	}
	out.State = "submitting"
	submission, e := s.submit(out.TransactionHash)
	if e != nil {
		return fail(e)
	}
	if submission.TransactionHash != out.TransactionHash || (submission.Status != "acknowledged" && submission.Status != "submission_unknown") {
		return fail(ErrIntent)
	}
	out.State = "waiting_receipt"
	r, e := s.receipt()
	if e != nil {
		return fail(e)
	}
	if r.Observation.TransactionHash != out.TransactionHash {
		return fail(ErrIntent)
	}
	out.ReceiptStatus = r.Observation.Status
	switch out.ReceiptStatus {
	case "not_observed", "mined_success", "mined_reverted":
		return out, nil
	case "finalized_reverted":
		if e := s.finalize(r); e != nil {
			return fail(e)
		}
		out.ReservationReleased = true
		out.State = "finalized_reverted"
		return out, nil
	case "finalized_success":
		out.State = "verifying_accounting"
		id, e := s.evidence(r)
		if e != nil {
			return fail(e)
		}
		if id <= 0 {
			return fail(errors.New("execution evidence missing"))
		}
		out.EvidenceSequence = id
		out.AccountingVerified = true
		if e := s.finalize(r); e != nil {
			return fail(e)
		}
		out.ReservationReleased = true
		out.State = "accounting_verified"
		return out, nil
	default:
		return fail(ErrIntent)
	}
}
