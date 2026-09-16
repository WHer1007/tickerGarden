package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/events"
)

var hashRE = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var addressRE = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

type CurveSource struct {
	ChainID          uint64 `json:"chainId"`
	BlockNumber      string `json:"blockNumber"`
	BlockHash        string `json:"blockHash"`
	TransactionHash  string `json:"transactionHash"`
	TransactionIndex uint64 `json:"transactionIndex"`
	LogIndex         uint64 `json:"logIndex"`
	Emitter          string `json:"emitter"`
	EventKey         string `json:"eventKey"`
}
type CurveObservation struct {
	QuoteAsset      string       `json:"quoteAsset"`
	MemeToken       string       `json:"memeToken"`
	QuoteConfigID   string       `json:"quoteConfigId"`
	QuoteDecimals   uint8        `json:"quoteDecimals"`
	Source          CurveSource  `json:"source"`
	MarketID        string       `json:"marketId"`
	BlockTimestamp  string       `json:"blockTimestamp"`
	Amounts         CurveAmounts `json:"amounts"`
	Classification  string       `json:"classification"`
	Actor           string       `json:"actor"`
	Recipient       string       `json:"recipient"`
	ActorConfidence string       `json:"actorConfidence"`
}

// LoadCurveObservation reads existing canonical event facts; no second event
// ledger is introduced. Decimals come from the bound immutable quote config.
// Retired configs remain valid for historical observations, not new trades.
func LoadCurveObservation(ctx context.Context, pool *pgxpool.Pool, chain uint64, eventKey string) (CurveObservation, error) {
	if pool == nil {
		return CurveObservation{}, errCurve
	}
	return loadCurveObservation(ctx, pool, chain, eventKey)
}
func loadCurveObservation(ctx context.Context, pool rowReader, chain uint64, eventKey string) (CurveObservation, error) {
	if pool == nil || len(eventKey) > 160 || !strings.HasPrefix(eventKey, fmt.Sprint(chain)+":") {
		return CurveObservation{}, errCurve
	}
	var eventRaw, tradeRaw []byte
	var number, hash, timestamp, quoteAsset, memeToken, configID, decimals string
	err := pool.QueryRow(ctx, `SELECT e.payload,t.payload,b.number::text,b.hash,b.block_timestamp::text,m.payload->'values'->>'quoteAsset',m.payload->'values'->>'memeToken',q.payload->>'id',q.payload->'values'->>'quoteDecimals'
 FROM tickergarden.canonical_projection_rows e
 JOIN tickergarden.canonical_projection_rows t ON t.chain_id=e.chain_id AND t.row_key=e.row_key AND t.block_hash=e.block_hash AND t.table_name='curveTrades'
 JOIN tickergarden.canonical_projection_rows m ON m.chain_id=e.chain_id AND m.table_name='markets' AND m.row_key=t.payload->'values'->>'marketId'
 JOIN tickergarden.canonical_projection_rows q ON q.chain_id=e.chain_id AND q.table_name='configs' AND q.row_key='quote:'||(m.payload->'values'->>'quoteAssetConfigId')
 JOIN tickergarden.chain_blocks b ON b.chain_id=e.chain_id AND b.hash=e.block_hash
 WHERE e.chain_id=$1 AND e.row_key=$2 AND e.table_name='events' AND b.block_timestamp IS NOT NULL
 AND m.payload->>'marketId'=m.row_key AND q.payload->>'kind'='quote'
 AND q.payload->>'id'=m.payload->'values'->>'quoteAssetConfigId'
 AND m.payload->'values'->>'curve'=e.payload->'provenance'->>'emitter'
 AND q.payload->'values'->>'quoteAsset'=m.payload->'values'->>'quoteAsset'
 AND octet_length(e.payload::text)<=65536 AND octet_length(t.payload::text)<=65536`, chain, eventKey).Scan(&eventRaw, &tradeRaw, &number, &hash, &timestamp, &quoteAsset, &memeToken, &configID, &decimals)
	if err != nil {
		return CurveObservation{}, errCurve
	}
	d, parseErr := strconv.ParseUint(decimals, 10, 8)
	if parseErr != nil || strconv.FormatUint(d, 10) != decimals || d < 6 || d > 18 || !hashRE.MatchString(configID) || !addressRE.MatchString(quoteAsset) || !addressRE.MatchString(memeToken) || memeToken == "0x"+strings.Repeat("0", 40) || (quoteAsset == "0x"+strings.Repeat("0", 40) && d != 18) {
		return CurveObservation{}, errCurve
	}
	quoteDecimals := uint8(d)
	out, err := normalizeCurveRows(eventRaw, tradeRaw, chain, eventKey, quoteDecimals)
	if err != nil || out.Source.BlockNumber != number || out.Source.BlockHash != hash {
		return CurveObservation{}, errCurve
	}
	out.BlockTimestamp = timestamp
	out.QuoteAsset = quoteAsset
	out.MemeToken = memeToken
	out.QuoteConfigID = configID
	out.QuoteDecimals = quoteDecimals
	return out, nil
}
func normalizeCurveRows(eventRaw, tradeRaw []byte, chain uint64, key string, decimals uint8) (CurveObservation, error) {
	var event struct {
		Provenance CurveSource    `json:"provenance"`
		Signature  string         `json:"signature"`
		Args       map[string]any `json:"args"`
	}
	var trade struct {
		Key        string         `json:"key"`
		Provenance CurveSource    `json:"provenance"`
		Values     map[string]any `json:"values"`
	}
	if len(eventRaw) > 65536 || len(tradeRaw) > 65536 || json.Unmarshal(eventRaw, &event) != nil || json.Unmarshal(tradeRaw, &trade) != nil {
		return CurveObservation{}, errCurve
	}
	source := event.Provenance
	if source != trade.Provenance || source.ChainID != chain || source.EventKey != key || trade.Key != key || key != fmt.Sprintf("%d:%s:%d", chain, source.TransactionHash, source.LogIndex) || !hashRE.MatchString(source.BlockHash) || !hashRE.MatchString(source.TransactionHash) || !addressRE.MatchString(source.Emitter) || !uintRE.MatchString(source.BlockNumber) {
		return CurveObservation{}, errCurve
	}
	market, ok := trade.Values["marketId"].(string)
	if !ok || !hashRE.MatchString(market) {
		return CurveObservation{}, errCurve
	}
	delete(trade.Values, "marketId")
	if !reflect.DeepEqual(event.Args, trade.Values) {
		return CurveObservation{}, errCurve
	}
	amounts, err := NormalizeCurveAmounts(events.Decoded{Module: "TickerGardenCurve", Signature: event.Signature, Args: event.Args}, decimals)
	if err != nil {
		return CurveObservation{}, err
	}
	actorKey := "buyer"
	if amounts.Side == "sell" {
		actorKey = "seller"
	}
	actor, aok := event.Args[actorKey].(string)
	recipient, rok := event.Args["recipient"].(string)
	if !aok || !rok || !addressRE.MatchString(actor) || !addressRE.MatchString(recipient) {
		return CurveObservation{}, errCurve
	}
	return CurveObservation{Source: source, MarketID: market, Amounts: amounts, Classification: "unclassified", Actor: actor, Recipient: recipient, ActorConfidence: "contract_caller_not_verified_wallet"}, nil
}
