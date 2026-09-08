package settlement

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

const execHash = "0x1111111111111111111111111111111111111111111111111111111111111111"

func execSigned(status string, withTx bool) SignResult {
	r := SignResult{Status: status}
	if withTx {
		r.Transaction = &SignedTransaction{TransactionHash: execHash}
	}
	return r
}
func execReceipt(status, hash string) ReceiptRecord {
	return ReceiptRecord{Observation: ReceiptObservation{Status: status, TransactionHash: hash}}
}
func execSteps(order *[]string, sign func() (SignResult, error), submit func(string) (Submission, error), receipt func() (ReceiptRecord, error), evidence func(ReceiptRecord) (int64, error)) executionSteps {
	return executionSteps{
		prepare:  func() error { *order = append(*order, "prepare"); return nil },
		sign:     func() (SignResult, error) { *order = append(*order, "sign"); return sign() },
		submit:   func(h string) (Submission, error) { *order = append(*order, "submit:"+h); return submit(h) },
		receipt:  func() (ReceiptRecord, error) { *order = append(*order, "receipt"); return receipt() },
		evidence: func(r ReceiptRecord) (int64, error) { *order = append(*order, "evidence"); return evidence(r) },
		finalize: func(r ReceiptRecord) error { *order = append(*order, "finalize"); return nil },
	}
}

func TestAdvanceExecutionExactOrderingAndFinalSuccess(t *testing.T) {
	var order []string
	s := execSteps(&order, func() (SignResult, error) { return execSigned("signed_stored", true), nil }, func(h string) (Submission, error) { return Submission{TransactionHash: h, Status: "acknowledged"}, nil }, func() (ReceiptRecord, error) { return execReceipt("finalized_success", execHash), nil }, func(ReceiptRecord) (int64, error) { return 7, nil })
	out, err := advanceExecution(context.Background(), "job", s)
	if err != nil || out.State != "accounting_verified" || !out.AccountingVerified || out.EvidenceSequence != 7 {
		t.Fatalf("out=%+v err=%v", out, err)
	}
	want := []string{"prepare", "sign", "submit:" + execHash, "receipt", "evidence", "finalize"}
	if !reflect.DeepEqual(order, want) {
		t.Fatalf("order=%v want=%v", order, want)
	}
}

func TestAdvanceExecutionUnknownSigningNeverSubmits(t *testing.T) {
	var order []string
	s := execSteps(&order, func() (SignResult, error) { return execSigned("signing_unknown", false), nil }, func(string) (Submission, error) { t.Fatal("submit called"); return Submission{}, nil }, func() (ReceiptRecord, error) { t.Fatal("receipt called"); return ReceiptRecord{}, nil }, func(ReceiptRecord) (int64, error) { t.Fatal("evidence called"); return 0, nil })
	out, err := advanceExecution(context.Background(), "job", s)
	if err != nil || out.State != "signing_reconciliation_required" {
		t.Fatalf("out=%+v err=%v", out, err)
	}
}

func TestAdvanceExecutionSubmissionUnknownObservesReceipt(t *testing.T) {
	var order []string
	s := execSteps(&order, func() (SignResult, error) { return execSigned("signed_stored", true), nil }, func(h string) (Submission, error) {
		return Submission{TransactionHash: h, Status: "submission_unknown"}, nil
	}, func() (ReceiptRecord, error) { return execReceipt("not_observed", execHash), nil }, func(ReceiptRecord) (int64, error) { t.Fatal("evidence called"); return 0, nil })
	out, err := advanceExecution(context.Background(), "job", s)
	if err != nil || out.State != "waiting_receipt" || out.ReceiptStatus != "not_observed" {
		t.Fatalf("out=%+v err=%v", out, err)
	}
	if !reflect.DeepEqual(order, []string{"prepare", "sign", "submit:" + execHash, "receipt"}) {
		t.Fatal(order)
	}
}

func TestAdvanceExecutionMinedAndRevertedSkipEvidence(t *testing.T) {
	for _, status := range []string{"mined_success", "mined_reverted", "finalized_reverted"} {
		t.Run(status, func(t *testing.T) {
			var evidenceCalls int
			finalized := 0
			s := executionSteps{prepare: func() error { return nil }, sign: func() (SignResult, error) { return execSigned("signed_stored", true), nil }, submit: func(h string) (Submission, error) { return Submission{TransactionHash: h, Status: "acknowledged"}, nil }, receipt: func() (ReceiptRecord, error) { return execReceipt(status, execHash), nil }, evidence: func(ReceiptRecord) (int64, error) { evidenceCalls++; return 1, nil }, finalize: func(ReceiptRecord) error { finalized++; return nil }}
			out, err := advanceExecution(context.Background(), "job", s)
			if err != nil || evidenceCalls != 0 {
				t.Fatalf("out=%+v err=%v evidence=%d", out, err, evidenceCalls)
			}
			if status == "finalized_reverted" && finalized != 1 {
				t.Fatalf("finalize=%d", finalized)
			}
			if status == "finalized_reverted" && (out.State != "finalized_reverted" || out.ReservationReleased == false || out.AccountingVerified) {
				t.Fatal(out.State)
			}
		})
	}
}

func TestAdvanceExecutionFinalizationFailureStopsSuccess(t *testing.T) {
	var evidence, finalized int
	s := executionSteps{prepare: func() error { return nil }, sign: func() (SignResult, error) { return execSigned("signed_stored", true), nil }, submit: func(h string) (Submission, error) { return Submission{TransactionHash: h, Status: "acknowledged"}, nil }, receipt: func() (ReceiptRecord, error) { return execReceipt("finalized_success", execHash), nil }, evidence: func(ReceiptRecord) (int64, error) { evidence++; return 9, nil }, finalize: func(ReceiptRecord) error { finalized++; return errors.New("release failed") }}
	out, err := advanceExecution(context.Background(), "job", s)
	if err == nil || evidence != 1 || finalized != 1 || !out.AccountingVerified || out.ReservationReleased {
		t.Fatalf("out=%+v err=%v", out, err)
	}
}

func TestAdvanceExecutionRejectsHashMismatch(t *testing.T) {
	var submits int
	s := executionSteps{prepare: func() error { return nil }, sign: func() (SignResult, error) { return execSigned("signed_stored", true), nil }, submit: func(h string) (Submission, error) {
		submits++
		return Submission{TransactionHash: "0x2222222222222222222222222222222222222222222222222222222222222222", Status: "acknowledged"}, nil
	}}
	out, err := advanceExecution(context.Background(), "job", s)
	if !errors.Is(err, ErrIntent) || submits != 1 || out.State != "submitting" {
		t.Fatalf("out=%+v err=%v submits=%d", out, err, submits)
	}
}

func TestAdvanceExecutionFailureAndCancellationDoNotContinue(t *testing.T) {
	var called int
	s := executionSteps{prepare: func() error { called++; return errors.New("prepare failed") }, sign: func() (SignResult, error) { called++; return execSigned("signed_stored", true), nil }}
	if _, err := advanceExecution(context.Background(), "job", s); err == nil || called != 1 {
		t.Fatalf("err=%v called=%d", err, called)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called = 0
	s.prepare = func() error { called++; return nil }
	if _, err := advanceExecution(ctx, "job", s); !errors.Is(err, context.Canceled) || called != 0 {
		t.Fatalf("err=%v called=%d", err, called)
	}
}

func TestAdvanceExecutionDurableRerunFixtureDoesNotResignOrResend(t *testing.T) {
	var signs, sends, receipts int
	signed := false
	submitted := false
	steps := executionSteps{prepare: func() error { return nil }, sign: func() (SignResult, error) {
		if !signed {
			signs++
			signed = true
		}
		return execSigned("signed_stored", true), nil
	}, submit: func(h string) (Submission, error) {
		if !submitted {
			sends++
			submitted = true
		}
		return Submission{TransactionHash: h, Status: "acknowledged"}, nil
	}, receipt: func() (ReceiptRecord, error) { receipts++; return execReceipt("not_observed", execHash), nil }}
	for i := 0; i < 2; i++ {
		if _, err := advanceExecution(context.Background(), "job", steps); err != nil {
			t.Fatal(err)
		}
	}
	if signs != 1 || sends != 1 || receipts != 2 {
		t.Fatalf("fixture calls signs=%d sends=%d receipts=%d", signs, sends, receipts)
	}
}
