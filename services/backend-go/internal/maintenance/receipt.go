package maintenance

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type ReceiptRPC interface {
	ChainID(context.Context) (uint64, error)
	Header(context.Context, string) (chainrpc.Header, error)
	TransactionReceipt(context.Context, string) (*chainrpc.Receipt, error)
	Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error)
}

type ReceiptObservation struct {
	JobKey          string            `json:"jobKey"`
	TransactionHash string            `json:"transactionHash"`
	ChainID         uint64            `json:"chainId"`
	GenesisHash     string            `json:"genesisHash"`
	Head            chainrpc.Header   `json:"head"`
	Finalized       chainrpc.Header   `json:"finalized"`
	Receipt         *chainrpc.Receipt `json:"receipt"`
	Status          string            `json:"status"`
}
type ReceiptRecord struct {
	Sequence    int64              `json:"sequence"`
	Digest      string             `json:"digest"`
	Observation ReceiptObservation `json:"observation"`
}

func validReceiptHeader(h chainrpc.Header) bool {
	_, e := h.Height()
	_, te := h.Time()
	return e == nil && te == nil && leaseHash.MatchString(h.Hash) && leaseHash.MatchString(h.ParentHash)
}
func receiptStatus(o ReceiptObservation) (string, error) {
	if !leaseHash.MatchString(o.JobKey) || !leaseHash.MatchString(o.TransactionHash) || !leaseHash.MatchString(o.GenesisHash) || !validReceiptHeader(o.Head) || !validReceiptHeader(o.Finalized) {
		return "", ErrUnavailable
	}
	head, _ := o.Head.Height()
	finalized, _ := o.Finalized.Height()
	ht, _ := o.Head.Time()
	ft, _ := o.Finalized.Time()
	if finalized > head || ft > ht || (finalized == head && o.Finalized != o.Head) {
		return "", ErrUnavailable
	}
	if o.Receipt == nil {
		return "not_observed", nil
	}
	r := o.Receipt
	if chainrpc.ValidateTransactionReceipt(o.TransactionHash, r) != nil {
		return "", ErrUnavailable
	}
	height, _ := chainrpc.Quantity(r.BlockNumber)
	if height > head || (height == head && !strings.EqualFold(r.BlockHash, o.Head.Hash)) || (height == finalized && !strings.EqualFold(r.BlockHash, o.Finalized.Hash)) {
		return "", ErrUnavailable
	}
	prefix := "mined_"
	if height <= finalized {
		prefix = "finalized_"
	}
	if r.Status == "0x0" {
		return prefix + "reverted", nil
	}
	return prefix + "success", nil
}

// ObserveReceipt appends evidence without changing acknowledgement or releasing
// the reserved nonce. Finality is asserted by the configured RPC source, checked
// against canonical headers and full-block receipt/log consistency, not a proof
// of receipt roots or of operation-specific postconditions.
func (s Store) ObserveReceipt(ctx context.Context, rpc ReceiptRPC, key string) (ReceiptRecord, error) {
	if s.Pool == nil || rpc == nil || !leaseHash.MatchString(key) {
		return ReceiptRecord{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return ReceiptRecord{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	in, signed, e := s.submissionMaterial(ctx, tx, key)
	if e != nil {
		return ReceiptRecord{}, ErrUnavailable
	}
	if _, e = submissionIn(ctx, tx, signed); e != nil {
		return ReceiptRecord{}, ErrUnavailable
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != s.ChainID {
		return ReceiptRecord{}, ErrUnavailable
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil || genesis.Hash != in.Intent.Reservation.GenesisHash {
		return ReceiptRecord{}, ErrUnavailable
	}
	head, e := rpc.Header(ctx, "latest")
	if e != nil {
		return ReceiptRecord{}, ErrUnavailable
	}
	finalized, e := rpc.Header(ctx, "finalized")
	if e != nil {
		return ReceiptRecord{}, ErrUnavailable
	}
	receipt, e := rpc.TransactionReceipt(ctx, signed.TransactionHash)
	if e != nil {
		return ReceiptRecord{}, ErrUnavailable
	}
	o := ReceiptObservation{JobKey: key, TransactionHash: signed.TransactionHash, ChainID: id, GenesisHash: genesis.Hash, Head: head, Finalized: finalized, Receipt: receipt}
	o.Status, e = receiptStatus(o)
	if e != nil {
		return ReceiptRecord{}, e
	}
	if receipt != nil {
		h, e := rpc.Header(ctx, receipt.BlockNumber)
		if e != nil || !strings.EqualFold(h.Hash, receipt.BlockHash) {
			return ReceiptRecord{}, ErrUnavailable
		}
		observed, e := rpc.Observe(ctx, h)
		if e != nil {
			return ReceiptRecord{}, ErrUnavailable
		}
		matches := 0
		for _, r := range observed.Receipts {
			if strings.EqualFold(r.TransactionHash, signed.TransactionHash) {
				if !reflect.DeepEqual(r, *receipt) {
					return ReceiptRecord{}, ErrUnavailable
				}
				matches++
			}
		}
		if matches != 1 {
			return ReceiptRecord{}, ErrUnavailable
		}
		h2, e := rpc.Header(ctx, receipt.BlockNumber)
		if e != nil || h2 != h {
			return ReceiptRecord{}, ErrUnavailable
		}
	}
	// Pin both ends again after the potentially slow full-block receipt read.
	for _, h := range []chainrpc.Header{head, finalized} {
		again, e := rpc.Header(ctx, h.Number)
		if e != nil || again != h {
			return ReceiptRecord{}, ErrUnavailable
		}
	}
	now, e := leaseNow(ctx, tx)
	timestamp, _ := head.Time()
	if e != nil || timestamp > uint64(now.Unix()+5) || now.Unix()-int64(timestamp) > 120 {
		return ReceiptRecord{}, ErrUnavailable
	}
	body, e := json.Marshal(o)
	if e != nil || len(body) > 65536 {
		return ReceiptRecord{}, ErrUnavailable
	}
	out := ReceiptRecord{Digest: deployment.Hash(body), Observation: o}
	e = tx.QueryRow(ctx, `INSERT INTO tickergarden.maintenance_receipt_observations(job_key,payload,digest) VALUES($1,$2,$3) RETURNING sequence`, key, body, out.Digest).Scan(&out.Sequence)
	if e != nil || tx.Commit(ctx) != nil {
		return ReceiptRecord{}, ErrUnavailable
	}
	return out, nil
}

// ReceiptHistory is historical evidence, not a fresh canonicality assertion.
func (s Store) ReceiptHistory(ctx context.Context, key string, after int64) ([]ReceiptRecord, error) {
	if s.Pool == nil || !leaseHash.MatchString(key) || after < 0 {
		return nil, ErrUnavailable
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if e != nil {
		return nil, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	in, signed, e := s.submissionMaterial(ctx, tx, key)
	if e != nil {
		return nil, ErrUnavailable
	}
	if _, e = submissionIn(ctx, tx, signed); e != nil {
		return nil, ErrUnavailable
	}
	rows, e := tx.Query(ctx, `SELECT sequence,payload,digest FROM tickergarden.maintenance_receipt_observations WHERE job_key=$1 AND sequence>$2 ORDER BY sequence LIMIT 100`, key, after)
	if e != nil {
		return nil, ErrUnavailable
	}
	defer rows.Close()
	out := []ReceiptRecord{}
	for rows.Next() {
		var r ReceiptRecord
		var raw []byte
		if rows.Scan(&r.Sequence, &raw, &r.Digest) != nil || len(raw) > 65536 || deployment.Hash(raw) != r.Digest || json.Unmarshal(raw, &r.Observation) != nil {
			return nil, ErrUnavailable
		}
		o := r.Observation
		status, e := receiptStatus(o)
		if e != nil || status != o.Status || o.JobKey != key || o.TransactionHash != signed.TransactionHash || o.ChainID != s.ChainID || o.GenesisHash != in.Intent.Reservation.GenesisHash {
			return nil, ErrUnavailable
		}
		out = append(out, r)
	}
	if rows.Err() != nil {
		return nil, ErrUnavailable
	}
	rows.Close()
	if tx.Commit(ctx) != nil {
		return nil, ErrUnavailable
	}
	return out, nil
}
