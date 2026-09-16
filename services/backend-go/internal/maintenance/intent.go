package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"reflect"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type Fees struct {
	GasLimit             string `json:"gasLimit"`
	MaxFeePerGas         string `json:"maxFeePerGas"`
	MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas"`
}
type Intent struct {
	Reservation      Reservation         `json:"reservation"`
	Call             chainrpc.IntentCall `json:"call"`
	SimulationDigest string              `json:"simulationDigest"`
	BlockHash        string              `json:"blockHash"`
	BlockNumber      string              `json:"blockNumber"`
	BlockTimestamp   string              `json:"blockTimestamp"`
	MaximumGasCost   string              `json:"maximumGasCost"`
	Type             string              `json:"type"`
	Status           string              `json:"status"`
}
type IntentRecord struct {
	Digest string `json:"digest"`
	Intent Intent `json:"intent"`
}
type IntentObserver interface {
	NonceObserver
	SimulateIntentAt(context.Context, chainrpc.IntentCall, string) ([]byte, error)
}

var feeDecimal = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

func intentCall(p deployment.MaintenancePreview, r Reservation, f Fees) (chainrpc.IntentCall, string, error) {
	bad := errors.New("invalid maintenance gas or fee bounds")
	nums := []*big.Int{}
	for _, s := range []string{f.GasLimit, f.MaxFeePerGas, f.MaxPriorityFeePerGas} {
		n, ok := new(big.Int).SetString(s, 10)
		if !ok || !feeDecimal.MatchString(s) || n.BitLen() > 256 {
			return chainrpc.IntentCall{}, "", bad
		}
		nums = append(nums, n)
	}
	if nums[0].BitLen() > 63 || nums[0].Cmp(big.NewInt(21000)) < 0 || nums[1].Sign() == 0 || nums[2].Cmp(nums[1]) > 0 {
		return chainrpc.IntentCall{}, "", bad
	}
	nonce, e := strconv.ParseUint(r.Nonce, 10, 63)
	if e != nil || strconv.FormatUint(nonce, 10) != r.Nonce {
		return chainrpc.IntentCall{}, "", bad
	}
	cost := new(big.Int).Mul(nums[0], nums[1])
	if cost.BitLen() > 256 {
		return chainrpc.IntentCall{}, "", bad
	}
	return chainrpc.IntentCall{From: p.From, To: p.To, Data: p.Data, Value: "0x0", Gas: "0x" + nums[0].Text(16), Nonce: "0x" + strconv.FormatUint(nonce, 16), MaxFeePerGas: "0x" + nums[1].Text(16), MaxPriorityFeePerGas: "0x" + nums[2].Text(16)}, cost.String(), nil
}
func intentIn(ctx context.Context, tx pgx.Tx, key string) (IntentRecord, error) {
	var raw []byte
	var result IntentRecord
	e := tx.QueryRow(ctx, `SELECT payload,digest FROM tickergarden.maintenance_transaction_intents WHERE job_key=$1`, key).Scan(&raw, &result.Digest)
	if e != nil {
		return result, e
	}
	if len(raw) > 16384 || deployment.Hash(raw) != result.Digest || json.Unmarshal(raw, &result.Intent) != nil {
		return IntentRecord{}, ErrUnavailable
	}
	return result, nil
}
func validateIntent(ctx context.Context, tx pgx.Tx, r Reservation, result IntentRecord) error {
	in := result.Intent
	if in.Reservation != r || in.Type != "0x2" || in.Status != "intent_prepared" {
		return ErrUnavailable
	}
	var raw []byte
	var p deployment.MaintenancePreview
	e := tx.QueryRow(ctx, `SELECT payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, r.JobKey, in.SimulationDigest).Scan(&raw)
	if e != nil || deployment.Hash(raw) != in.SimulationDigest || json.Unmarshal(raw, &p) != nil || deployment.ValidateMaintenancePreview(p) != nil || p.Key != r.JobKey || in.BlockHash != p.BlockHash || in.BlockNumber != p.BlockNumber || in.BlockTimestamp != p.BlockTimestamp {
		return ErrUnavailable
	}
	decimals := []string{}
	for _, s := range []string{in.Call.Gas, in.Call.MaxFeePerGas, in.Call.MaxPriorityFeePerGas} {
		if len(s) < 3 || s[:2] != "0x" {
			return ErrUnavailable
		}
		n, ok := new(big.Int).SetString(s[2:], 16)
		if !ok {
			return ErrUnavailable
		}
		decimals = append(decimals, n.String())
	}
	call, cost, e := intentCall(p, r, Fees{decimals[0], decimals[1], decimals[2]})
	if e != nil || call != in.Call || cost != in.MaximumGasCost {
		return ErrUnavailable
	}
	return nil
}
func (s Store) PrepareIntent(ctx context.Context, rpc IntentObserver, p deployment.MaintenancePreview, fees Fees, owner, token string, generation int64) (IntentRecord, error) {
	if s.Pool == nil {
		return IntentRecord{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return IntentRecord{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	result, e := s.prepareIntentIn(ctx, tx, rpc, p, fees, owner, token, generation)
	if e != nil {
		return IntentRecord{}, e
	}
	if tx.Commit(ctx) != nil {
		return IntentRecord{}, ErrUnavailable
	}
	return result, nil
}

func (s Store) prepareIntentIn(ctx context.Context, tx pgx.Tx, rpc IntentObserver, p deployment.MaintenancePreview, fees Fees, owner, token string, generation int64) (IntentRecord, error) {
	if s.Pool == nil || rpc == nil || deployment.ValidateMaintenancePreview(p) != nil || p.ChainID != s.ChainID || !validLeaseInput(p.Key, owner, token, 10) || generation < 1 {
		return IntentRecord{}, ErrUnavailable
	}
	var e error
	if e = s.lockLeaseJob(ctx, tx, p.Key); e != nil {
		return IntentRecord{}, e
	}
	r, e := reservationIn(ctx, tx, p.Key)
	if e != nil || r.Generation != generation || validateReservation(ctx, tx, r) != nil {
		return IntentRecord{}, ErrUnavailable
	}
	l, e := latestLease(ctx, tx, p.Key)
	if e != nil {
		return IntentRecord{}, ErrLeaseLost
	}
	now, e := leaseNow(ctx, tx)
	if e != nil || l.Generation != generation || l.Owner != owner || l.Token != token || l.Released || !l.ExpiresAt.After(now) {
		return IntentRecord{}, ErrLeaseLost
	}
	call, cost, e := intentCall(p, r, fees)
	if e != nil {
		return IntentRecord{}, e
	}
	old, e := intentIn(ctx, tx, p.Key)
	if e == nil {
		if validateIntent(ctx, tx, r, old) != nil || old.Intent.Call != call {
			return IntentRecord{}, errors.New("maintenance intent already fixed with different or invalid parameters")
		}
		return old, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return IntentRecord{}, ErrUnavailable
	}
	raw, e := json.Marshal(p)
	if e != nil {
		return IntentRecord{}, ErrUnavailable
	}
	simDigest := deployment.Hash(raw)
	var stored []byte
	e = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.maintenance_simulations WHERE job_key=$1 AND digest=$2`, p.Key, simDigest).Scan(&stored)
	if e != nil || !reflect.DeepEqual(raw, stored) {
		return IntentRecord{}, ErrUnavailable
	}
	timestamp, e := chainrpc.Quantity(p.BlockTimestamp)
	if e != nil || timestamp > uint64(now.Unix()+5) || now.Unix()-int64(timestamp) > 120 {
		return IntentRecord{}, ErrUnavailable
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != r.ChainID {
		return IntentRecord{}, ErrUnavailable
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil || genesis.Hash != r.GenesisHash {
		return IntentRecord{}, ErrUnavailable
	}
	pending, e := rpc.PendingNonce(ctx, r.Sender)
	nonce, _ := strconv.ParseUint(r.Nonce, 10, 63)
	if e != nil || pending > nonce {
		return IntentRecord{}, errors.New("reserved nonce is no longer available")
	}
	exactRaw, e := rpc.SimulateIntentAt(ctx, call, p.BlockHash)
	if e != nil {
		return IntentRecord{}, errors.New("exact maintenance intent simulation failed")
	}
	exactValues, e := deployment.DecodeMaintenanceReturn(p.Request, exactRaw)
	if e != nil || !reflect.DeepEqual(exactValues, p.ReturnValues) {
		return IntentRecord{}, errors.New("exact maintenance simulation differs from preview")
	}
	block, e := rpc.Header(ctx, p.BlockNumber)
	if e != nil || block.Hash != p.BlockHash || block.Timestamp != p.BlockTimestamp {
		return IntentRecord{}, ErrUnavailable
	}
	now, e = leaseNow(ctx, tx)
	if e != nil || !l.ExpiresAt.After(now) || now.Unix()-int64(timestamp) > 120 {
		return IntentRecord{}, ErrLeaseLost
	}
	in := Intent{Reservation: r, Call: call, SimulationDigest: simDigest, BlockHash: p.BlockHash, BlockNumber: p.BlockNumber, BlockTimestamp: p.BlockTimestamp, MaximumGasCost: cost, Type: "0x2", Status: "intent_prepared"}
	body, e := json.Marshal(in)
	if e != nil {
		return IntentRecord{}, ErrUnavailable
	}
	digest := deployment.Hash(body)
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_transaction_intents(job_key,payload,digest) VALUES($1,$2,$3)`, p.Key, body, digest)
	if e != nil {
		return IntentRecord{}, ErrUnavailable
	}
	return IntentRecord{Digest: digest, Intent: in}, nil
}
func (s Store) Intent(ctx context.Context, key string) (IntentRecord, error) {
	if s.Pool == nil || !leaseHash.MatchString(key) {
		return IntentRecord{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return IntentRecord{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = s.lockLeaseJob(ctx, tx, key); e != nil {
		return IntentRecord{}, e
	}
	r, e := reservationIn(ctx, tx, key)
	if e != nil || validateReservation(ctx, tx, r) != nil {
		return IntentRecord{}, ErrUnavailable
	}
	result, e := intentIn(ctx, tx, key)
	if e != nil || validateIntent(ctx, tx, r, result) != nil {
		return IntentRecord{}, ErrUnavailable
	}
	if tx.Commit(ctx) != nil {
		return IntentRecord{}, ErrUnavailable
	}
	return result, nil
}
