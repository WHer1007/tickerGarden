package maintenance

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/core/types"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

var signedQuantity = regexp.MustCompile(`^0x(?:0|[1-9a-f][0-9a-f]*)$`)

type SignedTransaction struct {
	JobKey          string `json:"jobKey"`
	IntentDigest    string `json:"intentDigest"`
	TransactionHash string `json:"transactionHash"`
	Sender          string `json:"sender"`
	RawTransaction  string `json:"rawTransaction"`
	Status          string `json:"status"`
}

// ValidateSigned accepts only canonical EIP-1559 signed bytes matching the fixed
// intent. The recovered sender, not a provider-supplied address, is authoritative.
func ValidateSigned(record IntentRecord, raw []byte) (SignedTransaction, error) {
	bad := errors.New("signed transaction does not match maintenance intent")
	body, e := json.Marshal(record.Intent)
	if e != nil || deployment.Hash(body) != record.Digest || len(raw) == 0 || len(raw) > 16384 {
		return SignedTransaction{}, bad
	}
	in := record.Intent
	if in.Type != "0x2" || in.Status != "intent_prepared" || in.Reservation.Status != "nonce_reserved" {
		return SignedTransaction{}, bad
	}
	var tx types.Transaction
	if tx.UnmarshalBinary(raw) != nil || tx.Type() != types.DynamicFeeTxType || tx.To() == nil || len(tx.AccessList()) != 0 {
		return SignedTransaction{}, bad
	}
	encoded, e := tx.MarshalBinary()
	if e != nil || !bytes.Equal(encoded, raw) {
		return SignedTransaction{}, bad
	}
	chain := new(big.Int).SetUint64(in.Reservation.ChainID)
	gas, e := chainrpc.Quantity(in.Call.Gas)
	if e != nil {
		return SignedTransaction{}, bad
	}
	nonce, e := chainrpc.Quantity(in.Call.Nonce)
	if e != nil {
		return SignedTransaction{}, bad
	}
	if in.Reservation.Nonce != strconv.FormatUint(nonce, 10) || !signedQuantity.MatchString(in.Call.MaxFeePerGas) || !signedQuantity.MatchString(in.Call.MaxPriorityFeePerGas) || !strings.HasPrefix(in.Call.Data, "0x") {
		return SignedTransaction{}, bad
	}
	expectedNonce, ok := new(big.Int).SetString(in.Reservation.Nonce, 10)
	if !ok || expectedNonce.Cmp(new(big.Int).SetUint64(nonce)) != 0 {
		return SignedTransaction{}, bad
	}
	if len(in.Call.MaxFeePerGas) < 3 || len(in.Call.MaxPriorityFeePerGas) < 3 || len(in.Call.Data) < 2 {
		return SignedTransaction{}, bad
	}
	fee, ok := new(big.Int).SetString(in.Call.MaxFeePerGas[2:], 16)
	if !ok {
		return SignedTransaction{}, bad
	}
	tip, ok := new(big.Int).SetString(in.Call.MaxPriorityFeePerGas[2:], 16)
	if !ok {
		return SignedTransaction{}, bad
	}
	data, e := hex.DecodeString(in.Call.Data[2:])
	if e != nil {
		return SignedTransaction{}, bad
	}
	if tx.ChainId().Cmp(chain) != 0 || tx.Nonce() != nonce || tx.Gas() != gas || tx.GasFeeCap().Cmp(fee) != 0 || tx.GasTipCap().Cmp(tip) != 0 || tx.Value().Sign() != 0 || in.Call.Value != "0x0" || strings.ToLower(tx.To().Hex()) != in.Call.To || !bytes.Equal(tx.Data(), data) {
		return SignedTransaction{}, bad
	}
	sender, e := types.Sender(types.NewLondonSigner(chain), &tx)
	if e != nil || strings.ToLower(sender.Hex()) != in.Call.From || in.Call.From != in.Reservation.Sender {
		return SignedTransaction{}, bad
	}
	return SignedTransaction{JobKey: in.Reservation.JobKey, IntentDigest: record.Digest, TransactionHash: strings.ToLower(tx.Hash().Hex()), Sender: in.Call.From, RawTransaction: "0x" + hex.EncodeToString(raw), Status: "signed_stored"}, nil
}
func signedIn(ctx context.Context, tx pgx.Tx, key string, record IntentRecord) (SignedTransaction, error) {
	var raw []byte
	var digest, hash string
	e := tx.QueryRow(ctx, `SELECT intent_digest,transaction_hash,raw_transaction FROM tickergarden.maintenance_signed_transactions WHERE job_key=$1`, key).Scan(&digest, &hash, &raw)
	if e != nil {
		return SignedTransaction{}, e
	}
	signed, e := ValidateSigned(record, raw)
	if e != nil || digest != record.Digest || signed.TransactionHash != hash {
		return SignedTransaction{}, ErrUnavailable
	}
	return signed, nil
}
func (s Store) AttachSigned(ctx context.Context, key, digest, owner, token string, generation int64, raw []byte) (SignedTransaction, error) {
	if s.Pool == nil || !validLeaseInput(key, owner, token, 10) || !leaseHash.MatchString(digest) || generation < 1 || len(raw) > 16384 {
		return SignedTransaction{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return SignedTransaction{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = s.lockLeaseJob(ctx, tx, key); e != nil {
		return SignedTransaction{}, e
	}
	r, e := reservationIn(ctx, tx, key)
	if e != nil || r.Generation != generation || validateReservation(ctx, tx, r) != nil {
		return SignedTransaction{}, ErrUnavailable
	}
	l, e := latestLease(ctx, tx, key)
	if e != nil {
		return SignedTransaction{}, ErrLeaseLost
	}
	now, e := leaseNow(ctx, tx)
	if e != nil || l.Generation != generation || l.Owner != owner || l.Token != token || l.Released || !l.ExpiresAt.After(now) {
		return SignedTransaction{}, ErrLeaseLost
	}
	record, e := intentIn(ctx, tx, key)
	if e != nil || record.Digest != digest || validateIntent(ctx, tx, r, record) != nil {
		return SignedTransaction{}, ErrUnavailable
	}
	signed, e := ValidateSigned(record, raw)
	if e != nil {
		return SignedTransaction{}, e
	}
	existing, e := signedIn(ctx, tx, key, record)
	if e == nil {
		if existing != signed {
			return SignedTransaction{}, errors.New("maintenance signed bytes already fixed")
		}
		if tx.Commit(ctx) != nil {
			return SignedTransaction{}, ErrUnavailable
		}
		return existing, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return SignedTransaction{}, ErrUnavailable
	}
	now, e = leaseNow(ctx, tx)
	if e != nil || !l.ExpiresAt.After(now) {
		return SignedTransaction{}, ErrLeaseLost
	}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_signed_transactions(job_key,intent_digest,transaction_hash,raw_transaction) VALUES($1,$2,$3,$4)`, key, digest, signed.TransactionHash, raw)
	if e != nil || tx.Commit(ctx) != nil {
		return SignedTransaction{}, ErrUnavailable
	}
	return signed, nil
}
func (s Store) Signed(ctx context.Context, key string) (SignedTransaction, error) {
	if s.Pool == nil || !leaseHash.MatchString(key) {
		return SignedTransaction{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return SignedTransaction{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if e = s.lockLeaseJob(ctx, tx, key); e != nil {
		return SignedTransaction{}, e
	}
	r, e := reservationIn(ctx, tx, key)
	if e != nil || validateReservation(ctx, tx, r) != nil {
		return SignedTransaction{}, ErrUnavailable
	}
	record, e := intentIn(ctx, tx, key)
	if e != nil || validateIntent(ctx, tx, r, record) != nil {
		return SignedTransaction{}, ErrUnavailable
	}
	result, e := signedIn(ctx, tx, key, record)
	if e != nil {
		return SignedTransaction{}, ErrUnavailable
	}
	if tx.Commit(ctx) != nil {
		return SignedTransaction{}, ErrUnavailable
	}
	return result, nil
}
