package settlement

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"strings"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

type ReceiptTraceRPC interface {
	ReceiptRPC
	TransactionCallTrace(context.Context, string) (chainrpc.CallTrace, error)
}
type ReceiptTrace struct {
	Receipt ReceiptRecord      `json:"receipt"`
	Events  ReceiptEventMatch  `json:"events"`
	Trace   chainrpc.CallTrace `json:"trace"`
}

func matchTraceRoot(in IntentRecord, event ReceiptEventMatch, trace chainrpc.CallTrace) error {
	if trace.Type != "CALL" || trace.Error != "" || !strings.EqualFold(trace.From, in.Intent.Call.From) || !strings.EqualFold(trace.To, in.Intent.Call.To) || trace.Input != in.Intent.Call.Data || trace.Value != in.Intent.Call.Value {
		return ErrIntent
	}
	if !strings.HasPrefix(trace.Output, "0x") {
		return ErrIntent
	}
	raw, err := hex.DecodeString(trace.Output[2:])
	if err != nil {
		return ErrIntent
	}
	values, err := events.DecodeStatic([]events.Input{{Name: "spent", Type: "uint256"}, {Name: "received", Type: "uint256"}}, raw)
	if err != nil || values["spent"] != event.MemeSpent || values["received"] != event.QuoteReceived {
		return ErrIntent
	}
	return nil
}

// TraceReceipt binds an RPC execution trace to fresh canonical receipt evidence
// and the immutable signed intent. Nested frames remain unverified inputs for
// operation-specific accounting, not proof that refunds were reconciled.
func (s Store) TraceReceipt(ctx context.Context, rpc ReceiptTraceRPC, scope WorkScope, key string) (ReceiptTrace, error) {
	if rpc == nil {
		return ReceiptTrace{}, ErrIntent
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	record, err := s.ObserveReceipt(ctx, rpc, scope, key)
	if err != nil {
		return ReceiptTrace{}, err
	}
	matched, err := s.ReceiptEvents(ctx, scope, key, record.Sequence)
	if err != nil {
		return ReceiptTrace{}, err
	}
	in, err := s.Intent(ctx, scope, key)
	if err != nil {
		return ReceiptTrace{}, err
	}
	trace, err := rpc.TransactionCallTrace(ctx, matched.TransactionHash)
	if err != nil || matchTraceRoot(in, matched, trace) != nil {
		return ReceiptTrace{}, ErrIntent
	}
	if err := recheckTraceReceipt(ctx, rpc, record, matched.TransactionHash); err != nil {
		return ReceiptTrace{}, err
	}
	return ReceiptTrace{Receipt: record, Events: matched, Trace: trace}, nil
}

func recheckTraceReceipt(ctx context.Context, rpc ReceiptRPC, record ReceiptRecord, hash string) error {
	r := record.Observation.Receipt
	h, err := rpc.Header(ctx, r.BlockNumber)
	if err != nil || h.Hash != r.BlockHash {
		return ErrIntent
	}
	again, err := rpc.TransactionReceipt(ctx, hash)
	if err != nil || !reflect.DeepEqual(again, r) {
		return ErrIntent
	}
	for _, head := range []chainrpc.Header{record.Observation.Head, record.Observation.Finalized, h} {
		current, err := rpc.Header(ctx, head.Number)
		if err != nil || current != head {
			return ErrIntent
		}
	}
	stamp, err := record.Observation.Head.Time()
	now := time.Now().Unix()
	if err != nil || stamp > uint64(now+5) || now-int64(stamp) > 120 {
		return ErrIntent
	}
	return nil
}

type ReceiptAccounting struct {
	Evidence   ReceiptTrace    `json:"evidence"`
	Accounting TraceAccounting `json:"accounting"`
}

func (s Store) TraceAccounting(ctx context.Context, rpc ReceiptTraceRPC, scope WorkScope, key string) (ReceiptAccounting, error) {
	evidence, err := s.TraceReceipt(ctx, rpc, scope, key)
	if err != nil {
		return ReceiptAccounting{}, err
	}
	preview, err := s.receiptPreview(ctx, scope, key)
	if err != nil {
		return ReceiptAccounting{}, err
	}
	result, err := matchTraceAccounting(preview, evidence.Events, evidence.Trace)
	if err != nil {
		return ReceiptAccounting{}, err
	}
	return ReceiptAccounting{Evidence: evidence, Accounting: result}, nil
}

func (s Store) receiptPreview(ctx context.Context, scope WorkScope, key string) (ConversionPreview, error) {
	in, err := s.Intent(ctx, scope, key)
	if err != nil {
		return ConversionPreview{}, err
	}
	var body []byte
	if err = s.Pool.QueryRow(ctx, `SELECT payload FROM tickergarden.settlement_checks WHERE sequence=$1`, in.Intent.CheckSequence).Scan(&body); err != nil {
		return ConversionPreview{}, err
	}
	var proof struct{ Result checkedEnvelope }
	if receiptDigest(body) != in.Intent.CheckDigest || json.Unmarshal(body, &proof) != nil {
		return ConversionPreview{}, ErrIntent
	}
	return proof.Result.Preview, nil
}

type ReceiptStateRPC interface {
	ReceiptTraceRPC
	TransactionState(context.Context, string) (chainrpc.TransactionStateTrace, error)
}
type ReceiptCreatorStorage struct {
	Evidence       ReceiptAccounting              `json:"evidence"`
	State          chainrpc.TransactionStateTrace `json:"state"`
	CreatorStorage CreatorStorageAccounting       `json:"creatorStorage"`
}

// TraceCreatorStorage checks RPC-observed internal Creator liabilities. Gauge
// storage, aggregate buckets and token balances remain separate pending checks.
func (s Store) TraceCreatorStorage(ctx context.Context, rpc ReceiptStateRPC, scope WorkScope, key string) (ReceiptCreatorStorage, error) {
	ctx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	evidence, err := s.TraceAccounting(ctx, rpc, scope, key)
	if err != nil {
		return ReceiptCreatorStorage{}, err
	}
	preview, err := s.receiptPreview(ctx, scope, key)
	if err != nil {
		return ReceiptCreatorStorage{}, err
	}
	state, err := rpc.TransactionState(ctx, evidence.Evidence.Events.TransactionHash)
	if err != nil {
		return ReceiptCreatorStorage{}, err
	}
	result, err := matchCreatorStorage(preview, evidence.Evidence.Events, evidence.Accounting, state)
	if err != nil {
		return ReceiptCreatorStorage{}, err
	}
	if err = recheckTraceReceipt(ctx, rpc, evidence.Evidence.Receipt, evidence.Evidence.Events.TransactionHash); err != nil {
		return ReceiptCreatorStorage{}, err
	}
	return ReceiptCreatorStorage{Evidence: evidence, State: state, CreatorStorage: result}, nil
}

type ReceiptLiabilityStorage struct {
	Evidence    ReceiptCreatorStorage      `json:"evidence"`
	Liabilities LiabilityStorageAccounting `json:"liabilities"`
}

func (s Store) TraceLiabilityStorage(ctx context.Context, rpc ReceiptStateRPC, scope WorkScope, key string) (ReceiptLiabilityStorage, error) {
	ctx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	evidence, e := s.TraceCreatorStorage(ctx, rpc, scope, key)
	if e != nil {
		return ReceiptLiabilityStorage{}, e
	}
	preview, e := s.receiptPreview(ctx, scope, key)
	if e != nil {
		return ReceiptLiabilityStorage{}, e
	}
	result, e := matchLiabilityStorage(preview, evidence.Evidence.Evidence.Events, evidence.State)
	if e != nil {
		return ReceiptLiabilityStorage{}, e
	}
	if e = recheckTraceReceipt(ctx, rpc, evidence.Evidence.Evidence.Receipt, evidence.Evidence.Evidence.Events.TransactionHash); e != nil {
		return ReceiptLiabilityStorage{}, e
	}
	return ReceiptLiabilityStorage{Evidence: evidence, Liabilities: result}, nil
}

type ReceiptGaugeStorage struct {
	Block      chainrpc.Header           `json:"block"`
	Balances   AssetBalanceAccounting    `json:"balances"`
	Remainders GaugeRemainderAccounting  `json:"remainders"`
	Activation GaugeActivationAccounting `json:"activation"`
	Evidence   ReceiptLiabilityStorage   `json:"evidence"`
	Gauge      GaugeStorageAccounting    `json:"gauge"`
}

func (s Store) TraceGaugeStorage(ctx context.Context, rpc ReceiptStateRPC, scope WorkScope, key string) (ReceiptGaugeStorage, error) {
	ctx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	evidence, e := s.TraceLiabilityStorage(ctx, rpc, scope, key)
	if e != nil {
		return ReceiptGaugeStorage{}, e
	}
	preview, e := s.receiptPreview(ctx, scope, key)
	if e != nil {
		return ReceiptGaugeStorage{}, e
	}
	trace := evidence.Evidence.Evidence.Evidence
	h, e := rpc.Header(ctx, trace.Receipt.Observation.Receipt.BlockNumber)
	if e != nil || h.Hash != trace.Receipt.Observation.Receipt.BlockHash {
		return ReceiptGaugeStorage{}, ErrIntent
	}
	timestamp, e := h.Time()
	if e != nil {
		return ReceiptGaugeStorage{}, ErrIntent
	}
	result, e := matchGaugeStorage(preview, trace.Events, evidence.Evidence.Evidence.Accounting, evidence.Evidence.State, timestamp)
	if e != nil {
		return ReceiptGaugeStorage{}, e
	}
	activation, e := matchGaugeActivation(preview, evidence.Evidence.State, result, timestamp)
	if e != nil {
		return ReceiptGaugeStorage{}, e
	}
	remainders, e := matchGaugeRemainders(preview, evidence.Evidence.State, result, trace.Trace)
	if e != nil {
		return ReceiptGaugeStorage{}, e
	}
	balances, e := matchAssetBalances(preview, trace.Events, evidence.Evidence.Evidence.Accounting, evidence.Evidence.CreatorStorage, evidence.Liabilities, trace.Trace, evidence.Evidence.State)
	if e != nil {
		return ReceiptGaugeStorage{}, e
	}
	again, e := rpc.Header(ctx, h.Number)
	if e != nil || again != h {
		return ReceiptGaugeStorage{}, ErrIntent
	}
	if e = recheckTraceReceipt(ctx, rpc, trace.Receipt, trace.Events.TransactionHash); e != nil {
		return ReceiptGaugeStorage{}, e
	}
	return ReceiptGaugeStorage{Block: h, Evidence: evidence, Gauge: result, Activation: activation, Remainders: remainders, Balances: balances}, nil
}
