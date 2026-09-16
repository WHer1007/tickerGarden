package maintenance

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type Submission struct {
	JobKey           string `json:"jobKey"`
	IntentDigest     string `json:"intentDigest"`
	TransactionHash  string `json:"transactionHash"`
	SimulationDigest string `json:"simulationDigest"`
	Status           string `json:"status"`
}

type SubmissionRPC interface {
	IntentObserver
	SendRawTransaction(context.Context, []byte) (string, error)
}

func (s Store) submissionMaterial(ctx context.Context, tx pgx.Tx, key string) (IntentRecord, SignedTransaction, error) {
	if e := s.lockLeaseJob(ctx, tx, key); e != nil {
		return IntentRecord{}, SignedTransaction{}, e
	}
	r, e := reservationIn(ctx, tx, key)
	if e != nil || validateReservation(ctx, tx, r) != nil {
		return IntentRecord{}, SignedTransaction{}, ErrUnavailable
	}
	in, e := intentIn(ctx, tx, key)
	if e != nil || validateIntent(ctx, tx, r, in) != nil {
		return IntentRecord{}, SignedTransaction{}, ErrUnavailable
	}
	signed, e := signedIn(ctx, tx, key, in)
	return in, signed, e
}

func submissionIn(ctx context.Context, tx pgx.Tx, signed SignedTransaction) (Submission, error) {
	var out Submission
	e := tx.QueryRow(ctx, `SELECT job_key,intent_digest,transaction_hash,simulation_digest,status FROM tickergarden.maintenance_submissions WHERE job_key=$1`, signed.JobKey).Scan(&out.JobKey, &out.IntentDigest, &out.TransactionHash, &out.SimulationDigest, &out.Status)
	if e != nil {
		return Submission{}, e
	}
	if out.IntentDigest != signed.IntentDigest || out.TransactionHash != signed.TransactionHash || (out.Status != "submission_unknown" && out.Status != "acknowledged") {
		return Submission{}, ErrUnavailable
	}
	var body []byte
	var p deployment.MaintenancePreview
	e = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, out.JobKey, out.SimulationDigest).Scan(&body)
	if e != nil || deployment.Hash(body) != out.SimulationDigest || json.Unmarshal(body, &p) != nil || deployment.ValidateMaintenancePreview(p) != nil || p.Key != out.JobKey {
		return Submission{}, ErrUnavailable
	}
	return out, nil
}

// Submit commits an unknown outcome before attempting the network write. A retry
// only reads the existing record, even after lease expiry, and never sends twice.
// The preview must come from authenticated deployment discovery. Exact signed
// parameters are simulated again here before the durable authorization record.
func (s Store) Submit(ctx context.Context, rpc SubmissionRPC, p deployment.MaintenancePreview, expectedHash, owner, token string, generation int64) (Submission, error) {
	if s.Pool == nil || rpc == nil || deployment.ValidateMaintenancePreview(p) != nil || p.ChainID != s.ChainID || !leaseHash.MatchString(expectedHash) || !validLeaseInput(p.Key, owner, token, 10) || generation < 1 {
		return Submission{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	in, signed, e := s.submissionMaterial(ctx, tx, p.Key)
	if e != nil || signed.TransactionHash != expectedHash || in.Intent.Reservation.Generation != generation {
		return Submission{}, ErrUnavailable
	}
	l, e := latestLease(ctx, tx, p.Key)
	if e != nil || l.Owner != owner || l.Token != token || l.Generation != generation {
		return Submission{}, ErrLeaseLost
	}
	old, e := submissionIn(ctx, tx, signed)
	if e == nil {
		if tx.Commit(ctx) != nil {
			return Submission{}, ErrUnavailable
		}
		return old, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Submission{}, ErrUnavailable
	}
	now, e := leaseNow(ctx, tx)
	timestamp, te := chainrpc.Quantity(p.BlockTimestamp)
	if e != nil || te != nil || l.Released || !l.ExpiresAt.After(now) || timestamp > uint64(now.Unix()+5) || now.Unix()-int64(timestamp) > 120 {
		return Submission{}, ErrLeaseLost
	}
	// Confirm the new preview still describes the fixed transaction's destination
	// and calldata, while allowing fresh simulation return amounts to change.
	call := in.Intent.Call
	if call.From != p.From || call.To != p.To || call.Data != p.Data || call.Value != p.Value {
		return Submission{}, ErrUnavailable
	}
	body, e := json.Marshal(p)
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	digest := deployment.Hash(body)
	var stored []byte
	e = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, p.Key, digest).Scan(&stored)
	if e != nil || !reflect.DeepEqual(body, stored) {
		return Submission{}, ErrUnavailable
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != s.ChainID {
		return Submission{}, ErrUnavailable
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil || genesis.Hash != in.Intent.Reservation.GenesisHash {
		return Submission{}, ErrUnavailable
	}
	pending, e := rpc.PendingNonce(ctx, p.From)
	nonce, _ := strconv.ParseUint(in.Intent.Reservation.Nonce, 10, 63)
	if e != nil || pending > nonce {
		return Submission{}, errors.New("reserved nonce is no longer available")
	}
	rawResult, e := rpc.SimulateIntentAt(ctx, call, p.BlockHash)
	if e != nil {
		return Submission{}, errors.New("submission simulation failed")
	}
	values, e := deployment.DecodeMaintenanceReturn(p.Request, rawResult)
	if e != nil || !reflect.DeepEqual(values, p.ReturnValues) {
		return Submission{}, errors.New("submission simulation differs from preview")
	}
	header, e := rpc.Header(ctx, p.BlockNumber)
	if e != nil || header.Hash != p.BlockHash || header.Timestamp != p.BlockTimestamp {
		return Submission{}, ErrUnavailable
	}
	now, e = leaseNow(ctx, tx)
	if e != nil || !l.ExpiresAt.After(now) || now.Unix()-int64(timestamp) > 120 {
		return Submission{}, ErrLeaseLost
	}
	out := Submission{JobKey: p.Key, IntentDigest: in.Digest, TransactionHash: signed.TransactionHash, SimulationDigest: digest, Status: "submission_unknown"}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_submissions(job_key,intent_digest,transaction_hash,simulation_digest,status) VALUES($1,$2,$3,$4,$5)`, out.JobKey, out.IntentDigest, out.TransactionHash, out.SimulationDigest, out.Status)
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	if e = s.chargeGasBudgetIn(ctx, tx, in); e != nil {
		return Submission{}, e
	}
	now, e = leaseNow(ctx, tx)
	if e != nil || !l.ExpiresAt.After(now) || now.Unix()-int64(timestamp) > 120 {
		return Submission{}, ErrLeaseLost
	}
	if tx.Commit(ctx) != nil {
		return Submission{}, ErrUnavailable
	}
	// No database transaction is open during broadcast. The committed row fences
	// concurrent callers and survives a crash immediately before/after this call.
	raw, _ := hex.DecodeString(signed.RawTransaction[2:])
	hash, e := rpc.SendRawTransaction(ctx, raw)
	if e != nil || hash != out.TransactionHash {
		return out, chainrpc.ErrSubmissionUnknown
	}
	tag, e := s.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_submissions SET status='acknowledged',acknowledged_at=clock_timestamp() WHERE job_key=$1 AND intent_digest=$2 AND transaction_hash=$3 AND simulation_digest=$4 AND status='submission_unknown'`, out.JobKey, out.IntentDigest, out.TransactionHash, out.SimulationDigest)
	if e != nil || tag.RowsAffected() != 1 {
		return out, chainrpc.ErrSubmissionUnknown
	}
	out.Status = "acknowledged"
	return out, nil
}

// Submission validates the persisted signing chain without requiring a live
// preparation lease. Unknown is retained until explicit recovery reconciles it.
func (s Store) Submission(ctx context.Context, key string) (Submission, error) {
	if s.Pool == nil || !leaseHash.MatchString(key) {
		return Submission{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	_, signed, e := s.submissionMaterial(ctx, tx, key)
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	out, e := submissionIn(ctx, tx, signed)
	if e != nil {
		return Submission{}, ErrUnavailable
	}
	if tx.Commit(ctx) != nil {
		return Submission{}, ErrUnavailable
	}
	return out, nil
}
