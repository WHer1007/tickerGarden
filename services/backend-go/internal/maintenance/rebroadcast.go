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

type RebroadcastRPC interface {
	SubmissionRPC
	NonceAtHash(context.Context, string, string) (uint64, error)
	TransactionReceipt(context.Context, string) (*chainrpc.Receipt, error)
}
type Rebroadcast struct {
	JobKey           string `json:"jobKey"`
	AttemptID        string `json:"attemptId"`
	TransactionHash  string `json:"transactionHash"`
	SimulationDigest string `json:"simulationDigest"`
	Status           string `json:"status"`
}

func rebroadcastIn(ctx context.Context, tx pgx.Tx, signed SignedTransaction, attempt string) (Rebroadcast, error) {
	var out Rebroadcast
	e := tx.QueryRow(ctx, `SELECT job_key,attempt_id,transaction_hash,simulation_digest,status FROM tickergarden.maintenance_rebroadcasts WHERE job_key=$1 AND attempt_id=$2`, signed.JobKey, attempt).Scan(&out.JobKey, &out.AttemptID, &out.TransactionHash, &out.SimulationDigest, &out.Status)
	if e != nil {
		return Rebroadcast{}, e
	}
	if out.TransactionHash != signed.TransactionHash || (out.Status != "submission_unknown" && out.Status != "acknowledged") {
		return Rebroadcast{}, ErrUnavailable
	}
	var body []byte
	var p deployment.MaintenancePreview
	e = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, signed.JobKey, out.SimulationDigest).Scan(&body)
	if e != nil || deployment.Hash(body) != out.SimulationDigest || json.Unmarshal(body, &p) != nil || deployment.ValidateMaintenancePreview(p) != nil || p.Key != signed.JobKey {
		return Rebroadcast{}, ErrUnavailable
	}
	return out, nil
}

// Rebroadcast requires an explicit recovery request ID. The maintenance DB
// operator authorizes replay of fixed signed bytes, not a new nonce or signature.
// The original lease is deliberately not required: recovery outlives preparation.
func (s Store) Rebroadcast(ctx context.Context, rpc RebroadcastRPC, p deployment.MaintenancePreview, expectedHash, attempt string) (Rebroadcast, error) {
	if s.Pool == nil || rpc == nil || deployment.ValidateMaintenancePreview(p) != nil || p.ChainID != s.ChainID || !leaseHash.MatchString(expectedHash) || !leaseHash.MatchString(attempt) || attempt == "0x0000000000000000000000000000000000000000000000000000000000000000" {
		return Rebroadcast{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Rebroadcast{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	in, signed, e := s.submissionMaterial(ctx, tx, p.Key)
	if e != nil || signed.TransactionHash != expectedHash {
		return Rebroadcast{}, ErrUnavailable
	}
	if _, e = submissionIn(ctx, tx, signed); e != nil {
		return Rebroadcast{}, ErrUnavailable
	}
	old, e := rebroadcastIn(ctx, tx, signed, attempt)
	if e == nil {
		if tx.Commit(ctx) != nil {
			return Rebroadcast{}, ErrUnavailable
		}
		return old, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Rebroadcast{}, ErrUnavailable
	}
	call := in.Intent.Call
	if call.From != p.From || call.To != p.To || call.Data != p.Data || call.Value != p.Value {
		return Rebroadcast{}, ErrUnavailable
	}
	body, e := json.Marshal(p)
	if e != nil {
		return Rebroadcast{}, ErrUnavailable
	}
	digest := deployment.Hash(body)
	var stored []byte
	e = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, p.Key, digest).Scan(&stored)
	if e != nil || !reflect.DeepEqual(stored, body) {
		return Rebroadcast{}, ErrUnavailable
	}
	now, e := leaseNow(ctx, tx)
	timestamp, te := chainrpc.Quantity(p.BlockTimestamp)
	if e != nil || te != nil || timestamp > uint64(now.Unix()+5) || now.Unix()-int64(timestamp) > 120 {
		return Rebroadcast{}, ErrUnavailable
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != s.ChainID {
		return Rebroadcast{}, ErrUnavailable
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil || genesis.Hash != in.Intent.Reservation.GenesisHash {
		return Rebroadcast{}, ErrUnavailable
	}
	receipt, e := rpc.TransactionReceipt(ctx, signed.TransactionHash)
	if e != nil || receipt != nil {
		return Rebroadcast{}, errors.New("receipt already observed or unavailable; reconcile before rebroadcast")
	}
	confirmed, e := rpc.NonceAtHash(ctx, p.From, p.BlockHash)
	nonce, _ := strconv.ParseUint(in.Intent.Reservation.Nonce, 10, 63)
	if e != nil || confirmed > nonce {
		return Rebroadcast{}, errors.New("reserved nonce has been consumed or is unavailable")
	}
	rawResult, e := rpc.SimulateIntentAt(ctx, call, p.BlockHash)
	if e != nil {
		return Rebroadcast{}, errors.New("rebroadcast simulation failed")
	}
	values, e := deployment.DecodeMaintenanceReturn(p.Request, rawResult)
	if e != nil || !reflect.DeepEqual(values, p.ReturnValues) {
		return Rebroadcast{}, ErrUnavailable
	}
	header, e := rpc.Header(ctx, p.BlockNumber)
	if e != nil || header.Hash != p.BlockHash || header.Timestamp != p.BlockTimestamp {
		return Rebroadcast{}, ErrUnavailable
	}
	now, e = leaseNow(ctx, tx)
	if e != nil || now.Unix()-int64(timestamp) > 120 {
		return Rebroadcast{}, ErrUnavailable
	}
	out := Rebroadcast{JobKey: p.Key, AttemptID: attempt, TransactionHash: signed.TransactionHash, SimulationDigest: digest, Status: "submission_unknown"}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_rebroadcasts(job_key,attempt_id,transaction_hash,simulation_digest,status) VALUES($1,$2,$3,$4,$5)`, out.JobKey, out.AttemptID, out.TransactionHash, out.SimulationDigest, out.Status)
	if e != nil || tx.Commit(ctx) != nil {
		return Rebroadcast{}, ErrUnavailable
	}
	raw, _ := hex.DecodeString(signed.RawTransaction[2:])
	hash, e := rpc.SendRawTransaction(ctx, raw)
	if e != nil || hash != out.TransactionHash {
		return out, chainrpc.ErrSubmissionUnknown
	}
	tag, e := s.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_rebroadcasts SET status='acknowledged' WHERE job_key=$1 AND attempt_id=$2 AND transaction_hash=$3 AND simulation_digest=$4 AND status='submission_unknown'`, out.JobKey, out.AttemptID, out.TransactionHash, out.SimulationDigest)
	if e != nil || tag.RowsAffected() != 1 {
		return out, chainrpc.ErrSubmissionUnknown
	}
	out.Status = "acknowledged"
	return out, nil
}
func (s Store) RebroadcastAttempt(ctx context.Context, key, attempt string) (Rebroadcast, error) {
	if s.Pool == nil || !leaseHash.MatchString(key) || !leaseHash.MatchString(attempt) {
		return Rebroadcast{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Rebroadcast{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	_, signed, e := s.submissionMaterial(ctx, tx, key)
	if e != nil {
		return Rebroadcast{}, ErrUnavailable
	}
	if _, e = submissionIn(ctx, tx, signed); e != nil {
		return Rebroadcast{}, ErrUnavailable
	}
	out, e := rebroadcastIn(ctx, tx, signed, attempt)
	if e != nil {
		return Rebroadcast{}, ErrUnavailable
	}
	if tx.Commit(ctx) != nil {
		return Rebroadcast{}, ErrUnavailable
	}
	return out, nil
}
