package settlement

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"time"

	"crypto/sha256"
	"encoding/hex"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
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
	return e == nil && te == nil && hashPattern.MatchString(h.Hash) && hashPattern.MatchString(h.ParentHash)
}
func receiptStatus(o ReceiptObservation) (string, error) {
	if o.ChainID == 0 || !hashPattern.MatchString("0x"+o.JobKey) || !hashPattern.MatchString(o.TransactionHash) || !hashPattern.MatchString(o.GenesisHash) || !validReceiptHeader(o.Head) || !validReceiptHeader(o.Finalized) {
		return "", ErrIntent
	}
	head, _ := o.Head.Height()
	finalized, _ := o.Finalized.Height()
	ht, _ := o.Head.Time()
	ft, _ := o.Finalized.Time()
	if finalized > head || ft > ht || (finalized == head && o.Finalized != o.Head) {
		return "", ErrIntent
	}
	if o.Receipt == nil {
		return "not_observed", nil
	}
	r := o.Receipt
	if chainrpc.ValidateTransactionReceipt(o.TransactionHash, r) != nil {
		return "", ErrIntent
	}
	height, _ := chainrpc.Quantity(r.BlockNumber)
	if height > head || (height == head && !strings.EqualFold(r.BlockHash, o.Head.Hash)) || (height == finalized && !strings.EqualFold(r.BlockHash, o.Finalized.Hash)) {
		return "", ErrIntent
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
func (s Store) ObserveReceipt(ctx context.Context, rpc ReceiptRPC, scope WorkScope, key string) (ReceiptRecord, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID || rpc == nil || !hashPattern.MatchString("0x"+key) {
		return ReceiptRecord{}, fmt.Errorf("receipt scope: %w", ErrIntent)
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return ReceiptRecord{}, fmt.Errorf("receipt transaction begin: %w", ErrIntent)
	}
	defer tx.Rollback(ctx)
	in, signed, e := s.receiptMaterial(ctx, tx, scope, key)
	if e != nil {
		return ReceiptRecord{}, fmt.Errorf("receipt submission material: %w", ErrIntent)
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != s.ChainID {
		return ReceiptRecord{}, fmt.Errorf("receipt chain identity: %w", ErrIntent)
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil || genesis.Hash != in.Intent.GenesisHash {
		return ReceiptRecord{}, fmt.Errorf("receipt genesis identity: %w", ErrIntent)
	}
	head, e := rpc.Header(ctx, "latest")
	if e != nil {
		return ReceiptRecord{}, fmt.Errorf("receipt head read: %w", ErrIntent)
	}
	finalized, e := rpc.Header(ctx, "finalized")
	if e != nil {
		return ReceiptRecord{}, fmt.Errorf("receipt finalized read: %w", ErrIntent)
	}
	receipt, e := rpc.TransactionReceipt(ctx, signed.TransactionHash)
	if e != nil {
		return ReceiptRecord{}, fmt.Errorf("receipt receipt read: %w", ErrIntent)
	}
	o := ReceiptObservation{JobKey: key, TransactionHash: signed.TransactionHash, ChainID: id, GenesisHash: genesis.Hash, Head: head, Finalized: finalized, Receipt: receipt}
	o.Status, e = receiptStatus(o)
	if e != nil {
		return ReceiptRecord{}, e
	}
	if receipt != nil {
		h, e := rpc.Header(ctx, receipt.BlockNumber)
		if e != nil || !strings.EqualFold(h.Hash, receipt.BlockHash) {
			return ReceiptRecord{}, fmt.Errorf("receipt receipt block identity: %w", ErrIntent)
		}
		observed, e := rpc.Observe(ctx, h)
		if e != nil {
			return ReceiptRecord{}, fmt.Errorf("receipt full block observation: %w", ErrIntent)
		}
		matches := 0
		for _, r := range observed.Receipts {
			if strings.EqualFold(r.TransactionHash, signed.TransactionHash) {
				if !reflect.DeepEqual(r, *receipt) {
					return ReceiptRecord{}, fmt.Errorf("receipt receipt consistency: %w", ErrIntent)
				}
				matches++
			}
		}
		if matches != 1 {
			return ReceiptRecord{}, fmt.Errorf("receipt receipt occurrence: %w", ErrIntent)
		}
		h2, e := rpc.Header(ctx, receipt.BlockNumber)
		if e != nil || h2 != h {
			return ReceiptRecord{}, fmt.Errorf("receipt receipt block recheck: %w", ErrIntent)
		}
	}
	// Pin both ends again after the potentially slow full-block receipt read.
	for _, h := range []chainrpc.Header{head, finalized} {
		again, e := rpc.Header(ctx, h.Number)
		if e != nil || again != h {
			return ReceiptRecord{}, fmt.Errorf("receipt head or finalized recheck: %w", ErrIntent)
		}
	}
	now := time.Now()
	timestamp, _ := head.Time()
	if timestamp > uint64(now.Unix()+5) || now.Unix()-int64(timestamp) > 120 {
		return ReceiptRecord{}, fmt.Errorf("receipt head freshness: %w", ErrIntent)
	}
	body, e := json.Marshal(o)
	if e != nil || len(body) > 65536 {
		return ReceiptRecord{}, fmt.Errorf("receipt payload size: %w", ErrIntent)
	}
	out := ReceiptRecord{Digest: receiptDigest(body), Observation: o}
	e = tx.QueryRow(ctx, `INSERT INTO tickergarden.settlement_receipt_observations(job_key,payload,digest) VALUES($1,$2,$3) RETURNING sequence`, key, body, out.Digest).Scan(&out.Sequence)
	if e != nil || tx.Commit(ctx) != nil {
		return ReceiptRecord{}, fmt.Errorf("receipt persistence: %w", ErrIntent)
	}
	return out, nil
}

// ReceiptHistory is historical evidence, not a fresh canonicality assertion.
func (s Store) ReceiptHistory(ctx context.Context, scope WorkScope, key string, after int64) ([]ReceiptRecord, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID || !hashPattern.MatchString("0x"+key) || after < 0 {
		return nil, ErrIntent
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if e != nil {
		return nil, ErrIntent
	}
	defer tx.Rollback(ctx)
	in, signed, e := s.receiptMaterial(ctx, tx, scope, key)
	if e != nil {
		return nil, ErrIntent
	}
	rows, e := tx.Query(ctx, `SELECT sequence,payload,digest FROM tickergarden.settlement_receipt_observations WHERE job_key=$1 AND sequence>$2 ORDER BY sequence LIMIT 100`, key, after)
	if e != nil {
		return nil, ErrIntent
	}
	defer rows.Close()
	out := []ReceiptRecord{}
	for rows.Next() {
		var r ReceiptRecord
		var raw []byte
		if rows.Scan(&r.Sequence, &raw, &r.Digest) != nil || len(raw) > 65536 || receiptDigest(raw) != r.Digest || json.Unmarshal(raw, &r.Observation) != nil {
			return nil, ErrIntent
		}
		o := r.Observation
		status, e := receiptStatus(o)
		if e != nil || status != o.Status || o.JobKey != key || o.TransactionHash != signed.TransactionHash || o.ChainID != s.ChainID || o.GenesisHash != in.Intent.GenesisHash {
			return nil, ErrIntent
		}
		out = append(out, r)
	}
	if rows.Err() != nil {
		return nil, ErrIntent
	}
	rows.Close()
	if tx.Commit(ctx) != nil {
		return nil, ErrIntent
	}
	return out, nil
}

func (s Store) receiptMaterial(ctx context.Context, tx pgx.Tx, scope WorkScope, key string) (IntentRecord, SignedTransaction, error) {
	return s.receiptMaterialWithLock(ctx, tx, scope, key, true)
}

func (s Store) receiptMaterialWithLock(ctx context.Context, tx pgx.Tx, scope WorkScope, key string, lock bool) (IntentRecord, SignedTransaction, error) {
	spec, err := loadWorkMaterial(ctx, tx, scope, key, lock)
	if err != nil {
		return IntentRecord{}, SignedTransaction{}, err
	}
	in, err := readIntent(ctx, tx, scope, key, spec)
	if err != nil {
		return in, SignedTransaction{}, err
	}
	_, raw, err := readSign(ctx, tx, in, spec)
	if err != nil || raw == nil {
		return in, SignedTransaction{}, ErrIntent
	}
	signed, err := ValidateSigned(in, raw)
	if err != nil {
		return in, signed, err
	}
	_, err = readSubmission(ctx, tx, in, spec, signed)
	return in, signed, err
}

func receiptDigest(body []byte) string { sum := sha256.Sum256(body); return hex.EncodeToString(sum[:]) }
