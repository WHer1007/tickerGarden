package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"math/big"
	"reflect"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

var ErrGasNotFinalized = errors.New("maintenance receipt is not finalized")

type GasCostRPC interface {
	ReceiptRPC
	TransactionGasReceipt(context.Context, string) (*chainrpc.GasReceipt, error)
}
type GasCost struct {
	JobKey              string `json:"jobKey"`
	IntentDigest        string `json:"intentDigest"`
	ReceiptSequence     int64  `json:"receiptSequence"`
	ReceiptDigest       string `json:"receiptDigest"`
	GasUsed             string `json:"gasUsed"`
	EffectiveGasPrice   string `json:"effectiveGasPrice"`
	ExecutionGasCost    string `json:"executionGasCost"`
	MaximumGasCost      string `json:"maximumGasCost"`
	ReceiptStatus       string `json:"receiptStatus"`
	TotalNativeFeeKnown bool   `json:"totalNativeFeeKnown"`
}
type GasCostRecord struct {
	Sequence int64   `json:"sequence"`
	Digest   string  `json:"digest"`
	Cost     GasCost `json:"cost"`
}

func calculateGasCost(in IntentRecord, r ReceiptRecord, gasUsed, effectivePrice string) (GasCost, error) {
	status, e := receiptStatus(r.Observation)
	if e != nil || status != r.Observation.Status {
		return GasCost{}, ErrUnavailable
	}
	if status != "finalized_success" && status != "finalized_reverted" {
		return GasCost{}, ErrGasNotFinalized
	}
	body, e := json.Marshal(r.Observation)
	if e != nil || deployment.Hash(body) != r.Digest || r.Sequence < 1 || r.Observation.JobKey != in.Intent.Reservation.JobKey {
		return GasCost{}, ErrUnavailable
	}
	gas, gok := budgetNumber(gasUsed)
	price, pok := budgetNumber(effectivePrice)
	limit, e := chainrpc.GasQuantity(in.Intent.Call.Gas)
	cap, ce := chainrpc.GasQuantity(in.Intent.Call.MaxFeePerGas)
	maximum, mok := budgetNumber(in.Intent.MaximumGasCost)
	if !gok || !pok || !mok || e != nil || ce != nil || gas.Cmp(big.NewInt(21000)) < 0 || gas.Cmp(limit) > 0 || price.Cmp(cap) > 0 {
		return GasCost{}, ErrUnavailable
	}
	actual := new(big.Int).Mul(gas, price)
	if actual.BitLen() > 256 || actual.Cmp(maximum) > 0 {
		return GasCost{}, ErrUnavailable
	}
	return GasCost{JobKey: r.Observation.JobKey, IntentDigest: in.Digest, ReceiptSequence: r.Sequence, ReceiptDigest: r.Digest, GasUsed: gasUsed, EffectiveGasPrice: effectivePrice, ExecutionGasCost: actual.String(), MaximumGasCost: in.Intent.MaximumGasCost, ReceiptStatus: status}, nil
}
func (s Store) ObserveGasCost(ctx context.Context, rpc GasCostRPC, key string) (GasCostRecord, error) {
	if rpc == nil {
		return GasCostRecord{}, ErrUnavailable
	}
	receipt, e := s.ObserveReceipt(ctx, rpc, key)
	if e != nil {
		return GasCostRecord{}, e
	}
	return s.observeGasFromReceipt(ctx, rpc, key, receipt)
}

// The caller must supply its fresh ObserveReceipt result. Reusing this evidence
// keeps gas and business poststate observations tied to the same receipt.
func (s Store) observeGasFromReceipt(ctx context.Context, rpc GasCostRPC, key string, receipt ReceiptRecord) (GasCostRecord, error) {
	status, e := receiptStatus(receipt.Observation)
	if e != nil || status != receipt.Observation.Status || receipt.Observation.JobKey != key {
		return GasCostRecord{}, ErrUnavailable
	}
	if status != "finalized_success" && status != "finalized_reverted" {
		return GasCostRecord{}, ErrGasNotFinalized
	}
	gas, e := rpc.TransactionGasReceipt(ctx, receipt.Observation.TransactionHash)
	if e != nil || gas == nil || !reflect.DeepEqual(gas.Receipt, *receipt.Observation.Receipt) {
		return GasCostRecord{}, ErrUnavailable
	}
	used, e := chainrpc.GasQuantity(gas.GasUsed)
	price, pe := chainrpc.GasQuantity(gas.EffectiveGasPrice)
	if e != nil || pe != nil {
		return GasCostRecord{}, ErrUnavailable
	}
	// Re-pin receipt and both finality anchors after retrieving the fee fields.
	h, e := rpc.Header(ctx, gas.BlockNumber)
	if e != nil || !validReceiptHeader(h) || h.Number != gas.BlockNumber || h.Hash != gas.BlockHash {
		return GasCostRecord{}, ErrUnavailable
	}
	for _, anchor := range []chainrpc.Header{receipt.Observation.Head, receipt.Observation.Finalized} {
		again, e := rpc.Header(ctx, anchor.Number)
		if e != nil || again != anchor {
			return GasCostRecord{}, ErrUnavailable
		}
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return GasCostRecord{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	in, signed, e := s.submissionMaterial(ctx, tx, key)
	if e != nil || signed.TransactionHash != receipt.Observation.TransactionHash {
		return GasCostRecord{}, ErrUnavailable
	}
	cost, e := calculateGasCost(in, receipt, used.String(), price.String())
	if e != nil {
		return GasCostRecord{}, e
	}
	now, e := leaseNow(ctx, tx)
	stamp, _ := receipt.Observation.Head.Time()
	if e != nil || stamp > uint64(now.Unix()+5) || now.Unix()-int64(stamp) > 120 {
		return GasCostRecord{}, ErrUnavailable
	}
	body, e := json.Marshal(cost)
	if e != nil {
		return GasCostRecord{}, ErrUnavailable
	}
	out := GasCostRecord{Digest: deployment.Hash(body), Cost: cost}
	if e = tx.QueryRow(ctx, `INSERT INTO tickergarden.maintenance_gas_observations(job_key,receipt_sequence,payload,digest) VALUES($1,$2,$3,$4) RETURNING sequence`, key, receipt.Sequence, body, out.Digest).Scan(&out.Sequence); e != nil || tx.Commit(ctx) != nil {
		return GasCostRecord{}, ErrUnavailable
	}
	return out, nil
}
func (s Store) GasCostHistory(ctx context.Context, key string, after int64) ([]GasCostRecord, error) {
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
	rows, e := tx.Query(ctx, `SELECT g.sequence,g.payload,g.digest,r.sequence,r.payload,r.digest FROM tickergarden.maintenance_gas_observations g JOIN tickergarden.maintenance_receipt_observations r ON r.job_key=g.job_key AND r.sequence=g.receipt_sequence WHERE g.job_key=$1 AND g.sequence>$2 ORDER BY g.sequence LIMIT 100`, key, after)
	if e != nil {
		return nil, ErrUnavailable
	}
	defer rows.Close()
	out := []GasCostRecord{}
	for rows.Next() {
		var record GasCostRecord
		var receipt ReceiptRecord
		var body, rbody []byte
		if e = rows.Scan(&record.Sequence, &body, &record.Digest, &receipt.Sequence, &rbody, &receipt.Digest); e != nil || deployment.Hash(body) != record.Digest || deployment.Hash(rbody) != receipt.Digest || json.Unmarshal(body, &record.Cost) != nil || json.Unmarshal(rbody, &receipt.Observation) != nil {
			return nil, ErrUnavailable
		}
		o := receipt.Observation
		if o.TransactionHash != signed.TransactionHash || o.ChainID != s.ChainID || o.GenesisHash != in.Intent.Reservation.GenesisHash {
			return nil, ErrUnavailable
		}
		calculated, e := calculateGasCost(in, receipt, record.Cost.GasUsed, record.Cost.EffectiveGasPrice)
		if e != nil || calculated != record.Cost {
			return nil, ErrUnavailable
		}
		out = append(out, record)
	}
	if e = rows.Err(); e != nil {
		return nil, ErrUnavailable
	}
	rows.Close()
	if tx.Commit(ctx) != nil {
		return nil, ErrUnavailable
	}
	return out, nil
}
