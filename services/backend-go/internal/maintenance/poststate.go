package maintenance

import (
	"context"
	"encoding/json"
	"errors"

	"tickergarden/backend/internal/deployment"
)

type PoststateRPC interface {
	ReceiptRPC
	deployment.BindingObserver
}
type PoststateEvidence struct {
	ReceiptSequence int64                           `json:"receiptSequence"`
	ReceiptDigest   string                          `json:"receiptDigest"`
	State           deployment.MaintenancePoststate `json:"state"`
}
type PoststateRecord struct {
	Sequence int64             `json:"sequence"`
	Digest   string            `json:"digest"`
	Evidence PoststateEvidence `json:"evidence"`
}

// VerifyPoststate requires a fresh finalized successful receipt and verifies the
// requested block-end condition on the same authenticated target. It conservatively
// reports unmet conditions if other transactions in that block recreated work.
func (s Store) VerifyPoststate(ctx context.Context, rpc PoststateRPC, m deployment.Manifest, key string) (PoststateRecord, error) {
	if m.ChainID != s.ChainID {
		return PoststateRecord{}, ErrUnavailable
	}
	observed, e := s.ObserveReceipt(ctx, rpc, key)
	if e != nil {
		return PoststateRecord{}, e
	}
	return s.verifyObservedPoststate(ctx, rpc, m, key, observed)
}

func (s Store) verifyObservedPoststate(ctx context.Context, rpc PoststateRPC, m deployment.Manifest, key string, observed ReceiptRecord) (PoststateRecord, error) {
	if observed.Observation.Status != "finalized_success" {
		return PoststateRecord{}, errors.New("poststate requires a finalized successful receipt")
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return PoststateRecord{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	in, signed, e := s.submissionMaterial(ctx, tx, key)
	if e != nil || signed.TransactionHash != observed.Observation.TransactionHash || m.GenesisHash != in.Intent.Reservation.GenesisHash {
		return PoststateRecord{}, ErrUnavailable
	}
	var raw []byte
	var p deployment.MaintenancePreview
	e = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, key, in.Intent.SimulationDigest).Scan(&raw)
	if e != nil || deployment.Hash(raw) != in.Intent.SimulationDigest || json.Unmarshal(raw, &p) != nil || deployment.ValidateMaintenancePreview(p) != nil {
		return PoststateRecord{}, ErrUnavailable
	}
	block, e := rpc.Header(ctx, observed.Observation.Receipt.BlockNumber)
	if e != nil || block.Hash != observed.Observation.Receipt.BlockHash {
		return PoststateRecord{}, ErrUnavailable
	}
	state, e := deployment.ObserveMaintenancePoststate(ctx, rpc, m, block, p.Request, in.Intent.Call.To)
	if e != nil {
		return PoststateRecord{}, e
	}
	final, e := rpc.Header(ctx, observed.Observation.Finalized.Number)
	if e != nil || final != observed.Observation.Finalized {
		return PoststateRecord{}, ErrUnavailable
	}
	now, e := leaseNow(ctx, tx)
	timestamp, _ := observed.Observation.Head.Time()
	if e != nil || now.Unix()-int64(timestamp) > 120 {
		return PoststateRecord{}, ErrUnavailable
	}
	evidence := PoststateEvidence{ReceiptSequence: observed.Sequence, ReceiptDigest: observed.Digest, State: state}
	body, e := json.Marshal(evidence)
	if e != nil || len(body) > 65536 {
		return PoststateRecord{}, ErrUnavailable
	}
	out := PoststateRecord{Digest: deployment.Hash(body), Evidence: evidence}
	e = tx.QueryRow(ctx, `INSERT INTO tickergarden.maintenance_poststates(job_key,receipt_sequence,payload,digest) VALUES($1,$2,$3,$4) RETURNING sequence`, key, observed.Sequence, body, out.Digest).Scan(&out.Sequence)
	if e != nil || tx.Commit(ctx) != nil {
		return PoststateRecord{}, ErrUnavailable
	}
	return out, nil
}
