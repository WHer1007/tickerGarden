package settlement

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"strconv"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/txaccount"
	"time"
)

type SignRequest struct {
	Version       string       `json:"version"`
	RequestID     string       `json:"requestId"`
	Intent        IntentRecord `json:"intent"`
	CheckSequence int64        `json:"checkSequence"`
	CheckDigest   string       `json:"checkDigest"`
	EvidenceJSON  string       `json:"evidenceJson"`
	NotAfter      int64        `json:"notAfter"`
}

func (s Store) authorizeIntent(ctx context.Context, tx pgx.Tx, rpc IntentRPC, spec WorkSpec, r IntentRecord, version string) (SignRequest, error) {
	if version != "settlement-sign-v1" && version != "settlement-submit-v1" {
		return SignRequest{}, ErrIntent
	}
	in := r.Intent
	now := time.Now().Unix()
	if now >= in.Deadline {
		return SignRequest{}, ErrIntent
	}
	if err := txaccount.Claim(ctx, tx, in.ChainID, in.GenesisHash, in.Call.From, "settlement"); err != nil {
		return SignRequest{}, err
	}
	nonce, err := strconv.ParseUint(in.Nonce, 10, 63)
	if err != nil {
		return SignRequest{}, ErrIntent
	}
	pending, err := rpc.PendingNonce(ctx, in.Call.From)
	if err != nil || pending != nonce {
		return SignRequest{}, ErrIntent
	}
	var raw []byte
	if tx.QueryRow(ctx, `SELECT payload FROM tickergarden.settlement_checks WHERE sequence=$1`, in.CheckSequence).Scan(&raw) != nil {
		return SignRequest{}, ErrIntent
	}
	var original struct{ Result checkedEnvelope }
	if json.Unmarshal(raw, &original) != nil || original.Result.Preview.Candidate.Plan == nil {
		return SignRequest{}, ErrIntent
	}
	// Preserve the immutable minimum and selection. Fresh signed references are
	// the price guard; this internal quote is only the original calldata floor.
	selection := spec.Selection
	selection.Deadline = in.Deadline
	selection.SlippageBps = 0
	selection.Quote = &Quote{ExpectedOutput: original.Result.Preview.Candidate.Plan.MinimumQuote, QuotedAt: now, RequestDigest: original.Result.Preview.Candidate.Request.RequestDigest, ReferenceID: version + ":" + r.Digest, MarketID: selection.MarketID, ChainID: in.ChainID}
	verified, err := VerifyConversion(ctx, rpc, spec.Manifest, selection, spec.Policy, true)
	if err != nil {
		return SignRequest{}, err
	}
	var checked checkedEnvelope
	if json.Unmarshal(verified.payload, &checked) != nil {
		return SignRequest{}, ErrIntent
	}
	p := checked.Preview
	call, cost, err := executionCall(p, nonce, in.Fees)
	if err != nil || call != in.Call || cost != in.MaximumGasCost {
		return SignRequest{}, ErrIntent
	}
	var held string
	if tx.QueryRow(ctx, `SELECT COALESCE(sum(maximum_gas_cost),0)::text FROM tickergarden.settlement_intents WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3`, in.ChainID, in.GenesisHash, in.Call.From).Scan(&held) != nil {
		return SignRequest{}, ErrIntent
	}
	reserve, err := amount(held)
	if err != nil {
		return SignRequest{}, ErrIntent
	}
	balance, err := rpc.BalanceAt(ctx, in.Call.From, p.Candidate.State.Block.Hash)
	if err != nil {
		return SignRequest{}, ErrIntent
	}
	available, err := amount(balance)
	if err != nil || available.Cmp(reserve) < 0 {
		return SignRequest{}, ErrIntent
	}
	exact, err := rpc.SimulateIntentAt(ctx, in.Call, p.Candidate.State.Block.Hash)
	if err != nil {
		return SignRequest{}, ErrIntent
	}
	values, err := events.DecodeStatic([]events.Input{{Name: "spent", Type: "uint256"}, {Name: "received", Type: "uint256"}}, exact)
	if err != nil || values["spent"] != p.Spent || values["received"] != p.Received {
		return SignRequest{}, ErrIntent
	}
	pending, err = rpc.PendingNonce(ctx, in.Call.From)
	if err != nil || pending != nonce {
		return SignRequest{}, ErrIntent
	}
	block, err := rpc.Header(ctx, p.Candidate.State.Block.Number)
	if err != nil || block != p.Candidate.State.Block {
		return SignRequest{}, ErrIntent
	}
	checkedAt := time.Now().Unix()
	if _, err = CheckReferences(p, spec.Policy, checked.ReferenceCheck.References, checkedAt); err != nil {
		return SignRequest{}, err
	}
	stamp, err := block.Time()
	if err != nil {
		return SignRequest{}, ErrIntent
	}
	notAfter := min(in.Deadline, now+30, int64(stamp)+120)
	for _, ref := range checked.ReferenceCheck.References {
		notAfter = min(notAfter, ref.Price.ExpiresAt, ref.Price.ObservedAt+spec.Policy.MaxAgeSeconds)
	}
	if notAfter <= checkedAt {
		return SignRequest{}, ErrIntent
	}
	evidence, err := s.recordIn(ctx, tx, verified)
	if err != nil {
		return SignRequest{}, err
	}
	return SignRequest{Version: version, RequestID: r.Digest, Intent: r, CheckSequence: evidence.Sequence, CheckDigest: evidence.Digest, EvidenceJSON: string(evidence.Payload), NotAfter: notAfter}, nil
}
