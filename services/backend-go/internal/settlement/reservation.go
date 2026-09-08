package settlement

import (
	"context"
	"encoding/json"
	"reflect"
	"time"
)

// releaseReservation is called only after a fresh terminal receipt. Successful
// executions additionally pass accounting evidence in the executor. It releases
// an off-chain gas hold, NOT a token balance, permission, or nonce reservation.
func (s Store) releaseReservation(ctx context.Context, rpc ReceiptRPC, scope WorkScope, key string, r ReceiptRecord) error {
	if r.Sequence <= 0 || r.Observation.JobKey != key || r.Observation.Receipt == nil {
		return ErrIntent
	}
	status, e := receiptStatus(r.Observation)
	if e != nil || status != r.Observation.Status || (status != "finalized_success" && status != "finalized_reverted") {
		return ErrIntent
	}
	stamp, e := r.Observation.Head.Time()
	if e != nil || int64(stamp) > time.Now().Unix()+5 || time.Now().Unix()-int64(stamp) > 120 {
		return ErrIntent
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return ErrIntent
	}
	defer tx.Rollback(context.Background())
	in, signed, e := s.receiptMaterial(ctx, tx, scope, key)
	if e != nil || signed.TransactionHash != r.Observation.TransactionHash {
		return ErrIntent
	}
	var raw []byte
	var digest string
	if tx.QueryRow(ctx, `SELECT payload,digest FROM tickergarden.settlement_receipt_observations WHERE sequence=$1 AND job_key=$2`, r.Sequence, key).Scan(&raw, &digest) != nil || receiptDigest(raw) != digest || digest != r.Digest {
		return ErrIntent
	}
	var persisted ReceiptObservation
	if json.Unmarshal(raw, &persisted) != nil || !reflect.DeepEqual(persisted, r.Observation) {
		return ErrIntent
	}
	// Serialize with PrepareIntent's balance-reservation calculation.
	var next uint64
	if tx.QueryRow(ctx, `SELECT next_nonce FROM tickergarden.settlement_nonce_accounts WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 FOR UPDATE`, scope.ChainID, scope.GenesisHash, scope.Operator).Scan(&next) != nil {
		return ErrIntent
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != scope.ChainID {
		return ErrIntent
	}
	gen, e := rpc.Header(ctx, "0x0")
	if e != nil || gen.Hash != in.Intent.GenesisHash {
		return ErrIntent
	}
	h, e := rpc.Header(ctx, persisted.Receipt.BlockNumber)
	if e != nil || h.Hash != persisted.Receipt.BlockHash {
		return ErrIntent
	}
	again, e := rpc.TransactionReceipt(ctx, signed.TransactionHash)
	if e != nil || !reflect.DeepEqual(again, persisted.Receipt) {
		return ErrIntent
	}
	f, e := rpc.Header(ctx, persisted.Finalized.Number)
	if e != nil || f != persisted.Finalized {
		return ErrIntent
	}
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.settlement_reservation_releases(job_key,receipt_sequence,receipt_digest,transaction_hash,block_hash,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, key, r.Sequence, r.Digest, signed.TransactionHash, persisted.Receipt.BlockHash, status); e != nil {
		return ErrIntent
	}
	var savedHash, block, savedStatus string
	if tx.QueryRow(ctx, `SELECT transaction_hash,block_hash,status FROM tickergarden.settlement_reservation_releases WHERE job_key=$1`, key).Scan(&savedHash, &block, &savedStatus) != nil || savedHash != signed.TransactionHash || block != persisted.Receipt.BlockHash || savedStatus != status {
		return ErrIntent
	}
	return tx.Commit(ctx)
}
