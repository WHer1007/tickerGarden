package treasury

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

// HistoryReport is a reviewer's attestation, not a cryptographic receipt-root
// proof. The report must describe an independently inspected source/evidence.
type HistoryReport struct {
	CandidateID        string `json:"candidateId"`
	InputDigest        string `json:"inputDigest"`
	HistoryComplete    bool   `json:"historyComplete"`
	EmptyEpochReviewed bool   `json:"emptyEpochReviewed"`
	Method             string `json:"method"`
	Evidence           string `json:"evidence"`
}
type Review struct {
	OperationID         string        `json:"operationId"`
	ProposalDigest      string        `json:"proposalDigest"`
	CandidateID         string        `json:"candidateId"`
	Reviewer            string        `json:"reviewer"`
	Decision            string        `json:"decision"`
	Reason              string        `json:"reason"`
	Report              HistoryReport `json:"historyReport"`
	ReferenceMatched    bool          `json:"referenceMatched"`
	JournalReplayed     bool          `json:"journalReplayed"`
	ReceiptRootVerified bool          `json:"receiptRootVerified"`
	ManifestHash        string        `json:"manifestHash"`
	ObservedBlockHash   string        `json:"observedBlockHash,omitempty"`
	ObservedBlockNumber string        `json:"observedBlockNumber,omitempty"`
	MerkleRoot          string        `json:"merkleRoot"`
	DatasetHash         string        `json:"datasetHash"`
}

func InputDigest(in Input) string { payload, _ := json.Marshal(in); return hash(payload) }
func DecodeDataset(data []byte) (Output, error) {
	if len(data) > 128<<20 {
		return Output{}, errors.New("review dataset exceeds budget")
	}
	if err := rejectAmbiguousJSON(data); err != nil {
		return Output{}, err
	}
	var out Output
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&out) != nil || out.Schema != Schema || out.Leaves == nil {
		return Output{}, errors.New("invalid review dataset")
	}
	out.Context = normalizedContext(out.Context)
	for i := range out.Leaves {
		out.Leaves[i].Account = strings.ToLower(out.Leaves[i].Account)
	}
	return out, nil
}
func DecodeHistoryReport(data []byte) (HistoryReport, error) {
	if len(data) > 1<<20 {
		return HistoryReport{}, errors.New("history report exceeds budget")
	}
	if err := rejectAmbiguousJSON(data); err != nil {
		return HistoryReport{}, err
	}
	var report HistoryReport
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&report) != nil {
		return HistoryReport{}, errors.New("invalid history report")
	}
	return report, nil
}
func reviewText(s string, max int) bool {
	if !utf8.ValidString(s) || strings.TrimSpace(s) != s || s == "" || utf8.RuneCountInString(s) > max {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return false
		}
	}
	return true
}
func compareReview(c Candidate, id string, reference Output, report HistoryReport, decision, reason string) error {
	if decision != "approved" && decision != "rejected" {
		return errors.New("invalid review decision")
	}
	if !reviewText(reason, 4096) || !reviewText(report.Method, 1024) || !reviewText(report.Evidence, 65536) || report.CandidateID != id || report.InputDigest != InputDigest(c.Input) {
		return errors.New("review evidence is missing or bound to different input")
	}
	if decision == "approved" {
		if !report.HistoryComplete {
			return errors.New("approval requires explicit history completeness attestation")
		}
		if c.Dataset.LeafCount == 0 && !report.EmptyEpochReviewed {
			return errors.New("empty epoch requires explicit independent review")
		}
		if !reflect.DeepEqual(reference, c.Dataset) {
			return errors.New("independent dataset differs from stored candidate")
		}
	}
	return nil
}

// RecordReview uses the review connection's database identity. Approval requires
// a supplied independent dataset, fresh request checks and a second journal
// replay. Human source completeness remains explicitly attested, not proven.
func RecordReview(ctx context.Context, store, journal *pgxpool.Pool, rpc deployment.BindingObserver, manifest deployment.Manifest, id, operation string, reference Output, report HistoryReport, decision, reason string) (string, error) {
	if !hashRE.MatchString(operation) || operation != strings.ToLower(operation) {
		return "", errors.New("stable lowercase review operation ID required")
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	c, err := ReadCandidate(ctx, store, id)
	if err != nil {
		return "", err
	}
	if err = compareReview(c, id, reference, report, decision, reason); err != nil {
		return "", err
	}
	manifest, mh, err := jobManifest(manifest)
	if err != nil {
		return "", err
	}
	if _, _, _, err = canonicalJob(JobSpec{Input: emptyTransfers(c.Input), Manifest: manifest}); err != nil {
		return "", err
	}
	var reviewer, creator string
	if err = store.QueryRow(ctx, `SELECT session_user,COALESCE(created_by,'') FROM tickergarden.treasury_candidates WHERE id=$1`, id).Scan(&reviewer, &creator); err != nil || creator == "" || reviewer == creator {
		return "", errors.New("review requires independent database identities and known candidate author")
	}
	r := Review{OperationID: operation, CandidateID: id, Reviewer: reviewer, Decision: decision, Reason: reason, Report: report, ManifestHash: mh, MerkleRoot: c.Dataset.MerkleRoot, DatasetHash: c.Dataset.DatasetHash}

	proposal, _ := json.Marshal(struct {
		Review    Review
		Reference Output
	}{r, reference})
	r.ProposalDigest = hash(proposal)
	var priorID string
	var priorPayload []byte
	priorErr := store.QueryRow(ctx, `SELECT id,payload FROM tickergarden.treasury_reviews WHERE operation_id=$1`, operation).Scan(&priorID, &priorPayload)
	if priorErr == nil {
		var prior Review
		if hash(priorPayload) != priorID || json.Unmarshal(priorPayload, &prior) != nil || prior.ProposalDigest != r.ProposalDigest || prior.Reviewer != reviewer {
			return "", errors.New("review operation ID already used or corrupted")
		}
		return priorID, nil
	}
	if !errors.Is(priorErr, pgx.ErrNoRows) {
		return "", errors.New("cannot inspect review operation")
	}
	if decision == "approved" {
		if journal == nil || rpc == nil || !c.Journal.ReceiptRootVerified {
			return "", errors.New("approval requires review journal, RPC and complete receipt root evidence")
		}
		block, e := rpc.Header(ctx, "latest")
		if e != nil {
			return "", errors.New("review request RPC unavailable")
		}
		ts, e := block.Time()
		now := time.Now().Unix()
		if e != nil || now < 0 || ts > uint64(now)+15 || (ts < uint64(now) && uint64(now)-ts > 120) {
			return "", errors.New("review request observation is stale")
		}
		observed, e := deployment.ObserveTreasuryRequest(ctx, rpc, manifest, block, c.Input.MarketID, c.Input.EpochID)
		if e != nil {
			return "", e
		}
		if e = MatchRequest(c.Input, observed); e != nil {
			return "", e
		}
		loaded, evidence, e := LoadJournalInput(ctx, journal, emptyTransfers(c.Input))
		if e != nil {
			return "", e
		}
		dataset, e := Generate(loaded)
		if e != nil || !reflect.DeepEqual(dataset, c.Dataset) || InputDigest(loaded) != InputDigest(c.Input) || !evidence.JournalRangeChecked || !evidence.ReceiptRootVerified {
			return "", errors.New("review journal replay differs from candidate")
		}
		last, e := rpc.Header(ctx, block.Number)
		if e != nil || last.Hash != block.Hash || last.Timestamp != block.Timestamp {
			return "", errors.New("review observation changed")
		}
		r.ReferenceMatched = true
		r.JournalReplayed = true
		r.ReceiptRootVerified = true
		r.ObservedBlockHash = block.Hash
		r.ObservedBlockNumber = block.Number
	}
	payload, err := json.Marshal(r)
	if err != nil || len(payload) > 2<<20 {
		return "", errors.New("review record exceeds budget")
	}
	reviewID := hash(payload)
	tx, err := store.Begin(ctx)
	if err != nil {
		return "", errors.New("cannot open review store")
	}
	defer tx.Rollback(ctx)
	// Serialize decisions per candidate. Re-submitting an identical old decision
	// is idempotent and cannot supersede a later rejection.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,821))`, id); err != nil {
		return "", errors.New("review store busy")
	}
	_, err = tx.Exec(ctx, `INSERT INTO tickergarden.treasury_reviews(id,candidate_id,decision,payload,operation_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(operation_id) DO NOTHING`, reviewID, id, decision, payload, operation)
	if err != nil {
		return "", errors.New("cannot persist independent review")
	}
	var stored []byte
	var storedReviewer, storedDecision, storedCandidate string
	err = tx.QueryRow(ctx, `SELECT id,payload,reviewer,decision,candidate_id FROM tickergarden.treasury_reviews WHERE operation_id=$1`, operation).Scan(&reviewID, &stored, &storedReviewer, &storedDecision, &storedCandidate)
	var committed Review
	if err != nil || hash(stored) != reviewID || json.Unmarshal(stored, &committed) != nil || committed.ProposalDigest != r.ProposalDigest || committed.OperationID != operation || storedReviewer != reviewer || storedDecision != decision || storedCandidate != id {
		return "", errors.New("review digest or index mismatch")
	}
	if err = tx.Commit(ctx); err != nil {
		return "", errors.New("review commit uncertain; retry same inputs")
	}
	return reviewID, nil
}
func emptyTransfers(in Input) Input { in.Transfers = []Transfer{}; return in }
func LatestReview(ctx context.Context, pool *pgxpool.Pool, candidateID string) (Review, error) {
	var payload []byte
	var id, reviewer, decision, operation string
	if !hashRE.MatchString(candidateID) {
		return Review{}, errors.New("invalid candidate ID")
	}
	err := pool.QueryRow(ctx, `SELECT id,payload,reviewer,decision,operation_id FROM tickergarden.treasury_reviews WHERE candidate_id=$1 ORDER BY sequence DESC LIMIT 1`, candidateID).Scan(&id, &payload, &reviewer, &decision, &operation)
	if err != nil || hash(payload) != id {
		return Review{}, errors.New("review unavailable or corrupted")
	}
	var review Review
	if json.Unmarshal(payload, &review) != nil || review.CandidateID != candidateID || review.Reviewer != reviewer || review.Decision != decision || review.OperationID != operation {
		return Review{}, errors.New("review index mismatch")
	}
	return review, nil
}
