package settlement

import (
	"context"
	"encoding/json"
	"math/big"
	"strconv"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

const itemEventTopic = "0x536d8aaaf2bd3a634add9a0cbb15879e5cd81e4ef97a16fe231d48974e4c49d2"
const batchEventTopic = "0x426c15483c6ec6406a71c28295cfba9e4798dc18360d4c6f13cf7cf4ba6ee811"

type ExecutedItem struct {
	User          string `json:"user"`
	CreatorEpoch  uint32 `json:"creatorEpoch"`
	MaximumMeme   string `json:"maximumMeme"`
	MemeSpent     string `json:"memeSpent"`
	QuoteReceived string `json:"quoteReceived"`
}
type ReceiptEventMatch struct {
	ReceiptSequence int64          `json:"receiptSequence"`
	ReceiptDigest   string         `json:"receiptDigest"`
	IntentDigest    string         `json:"intentDigest"`
	TransactionHash string         `json:"transactionHash"`
	MarketID        string         `json:"marketId"`
	BatchNonce      string         `json:"batchNonce"`
	MemeSpent       string         `json:"memeSpent"`
	QuoteReceived   string         `json:"quoteReceived"`
	Items           []ExecutedItem `json:"items"`
}

// matchReceiptEvents binds emitted amounts to the immutable signed request.
// MaximumMeme is a cap, not actual pulled funds. No refund is inferred here.
func matchReceiptEvents(r IntentRecord, p ConversionPreview, o ReceiptObservation) (ReceiptEventMatch, error) {
	fail := func() (ReceiptEventMatch, error) { return ReceiptEventMatch{}, ErrIntent }
	status, err := receiptStatus(o)
	if err != nil || status != "finalized_success" || o.Status != status || o.ChainID != r.Intent.ChainID || o.GenesisHash != r.Intent.GenesisHash || o.JobKey != r.Intent.JobKey || p.Candidate.Plan == nil || len(p.Candidate.Plan.Batches) != 1 {
		return fail()
	}
	b := p.Candidate.Plan.Batches[0]
	data, err := conversionData(b)
	if err != nil || data != r.Intent.Call.Data || p.To != r.Intent.Call.To {
		return fail()
	}
	minQuote, err := amount(b.MinimumQuote)
	if err != nil || minQuote.Sign() == 0 {
		return fail()
	}
	if chainrpc.ValidateTransactionReceipt(o.TransactionHash, o.Receipt) != nil {
		return fail()
	}
	out := ReceiptEventMatch{IntentDigest: r.Digest, TransactionHash: o.TransactionHash, MarketID: b.MarketID, Items: []ExecutedItem{}}
	spent, received := new(big.Int), new(big.Int)
	batchSeen := false
	for _, log := range o.Receipt.Logs {
		if len(log.Topics) == 0 || (log.Topics[0] != itemEventTopic && log.Topics[0] != batchEventTopic) {
			continue
		}
		if log.Address != r.Intent.Call.To || batchSeen {
			return fail()
		}
		event, err := events.Decode("ProtocolFeeVault", log)
		if err != nil {
			return fail()
		}
		args := event.Args
		str := func(key string) string { v, _ := args[key].(string); return v }
		if str("marketId") != b.MarketID {
			return fail()
		}
		m, e := amount(str("memeSpent"))
		if e != nil {
			return fail()
		}
		q, e := amount(str("quoteReceived"))
		if e != nil {
			return fail()
		}
		if log.Topics[0] == itemEventTopic {
			i := len(out.Items)
			if i >= len(b.Items) {
				return fail()
			}
			item := b.Items[i]
			maximum, e := amount(item.MaximumMeme)
			if e != nil || str("user") != item.User || str("creatorEpoch") != strconv.FormatUint(uint64(item.CreatorEpoch), 10) || m.Cmp(maximum) > 0 || (m.Sign() == 0) != (q.Sign() == 0) {
				return fail()
			}
			spent.Add(spent, m)
			received.Add(received, q)
			if spent.BitLen() > 256 || received.BitLen() > 256 {
				return fail()
			}
			out.Items = append(out.Items, ExecutedItem{User: item.User, CreatorEpoch: item.CreatorEpoch, MaximumMeme: item.MaximumMeme, MemeSpent: m.String(), QuoteReceived: q.String()})
		} else {
			nonce, e := amount(str("nonce"))
			if e != nil || nonce.Sign() == 0 || len(out.Items) != len(b.Items) || len(out.Items) == 0 || spent.Sign() == 0 || m.Cmp(spent) != 0 || q.Cmp(received) != 0 || received.Cmp(minQuote) < 0 || str("memeAsset") != p.Candidate.State.MemeToken || str("quoteAsset") != p.Candidate.State.QuoteAsset {
				return fail()
			}
			batchSeen = true
			out.BatchNonce = nonce.String()
			out.MemeSpent = m.String()
			out.QuoteReceived = q.String()
		}
	}
	if !batchSeen {
		return fail()
	}
	return out, nil
}

// ReceiptEvents revalidates one historical receipt against stored signed material.
// It does not refresh canonicality, prove transfers, or mark the job completed.
func (s Store) ReceiptEvents(ctx context.Context, scope WorkScope, key string, sequence int64) (ReceiptEventMatch, error) {
	if s.Pool == nil || s.ChainID != scope.ChainID || sequence <= 0 {
		return ReceiptEventMatch{}, ErrIntent
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return ReceiptEventMatch{}, err
	}
	defer tx.Rollback(ctx)
	in, signed, err := s.receiptMaterial(ctx, tx, scope, key)
	if err != nil {
		return ReceiptEventMatch{}, err
	}
	var body []byte
	var digest string
	if err = tx.QueryRow(ctx, `SELECT payload,digest FROM tickergarden.settlement_receipt_observations WHERE job_key=$1 AND sequence=$2`, key, sequence).Scan(&body, &digest); err != nil || receiptDigest(body) != digest {
		return ReceiptEventMatch{}, ErrIntent
	}
	var o ReceiptObservation
	if json.Unmarshal(body, &o) != nil || o.TransactionHash != signed.TransactionHash {
		return ReceiptEventMatch{}, ErrIntent
	}
	var proof []byte
	if err = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.settlement_checks WHERE sequence=$1`, in.Intent.CheckSequence).Scan(&proof); err != nil {
		return ReceiptEventMatch{}, err
	}
	var envelope struct{ Result checkedEnvelope }
	if json.Unmarshal(proof, &envelope) != nil {
		return ReceiptEventMatch{}, ErrIntent
	}
	out, err := matchReceiptEvents(in, envelope.Result.Preview, o)
	if err != nil {
		return out, err
	}
	out.ReceiptSequence = sequence
	out.ReceiptDigest = digest
	if err = tx.Commit(ctx); err != nil {
		return ReceiptEventMatch{}, err
	}
	return out, nil
}
