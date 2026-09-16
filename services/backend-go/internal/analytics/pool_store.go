package analytics

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/ethereum/go-ethereum/crypto"
	"reflect"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/events"
)

type PoolObservation struct {
	Sender         string       `json:"sender"`
	QuoteAsset     string       `json:"quoteAsset"`
	MemeToken      string       `json:"memeToken"`
	QuoteConfigID  string       `json:"quoteConfigId"`
	QuoteDecimals  uint8        `json:"quoteDecimals"`
	Source         CurveSource  `json:"source"`
	FeeSource      *CurveSource `json:"feeSource"`
	MarketID       string       `json:"marketId"`
	PoolID         string       `json:"poolId"`
	BlockTimestamp string       `json:"blockTimestamp"`
	Amounts        PoolAmounts  `json:"amounts"`
	Classification string       `json:"classification"`
}

// LoadPoolObservation consumes the projection's unique Swap/fee association.
// Pool identity and decimals are resolved from canonical persisted observations.
func LoadPoolObservation(ctx context.Context, pool *pgxpool.Pool, chain uint64, eventKey string) (PoolObservation, error) {
	if pool == nil {
		return PoolObservation{}, errPool
	}
	return loadPoolObservation(ctx, pool, chain, eventKey)
}
func loadPoolObservation(ctx context.Context, pool rowReader, chain uint64, eventKey string) (PoolObservation, error) {
	if pool == nil || len(eventKey) > 160 {
		return PoolObservation{}, errPool
	}
	var eventRaw, swapRaw, feeRaw []byte
	var number, hash, timestamp, market, poolID, meme, quote, decimals, configID, hook string
	var keyRaw []byte
	var matches int
	err := pool.QueryRow(ctx, `SELECT e.payload,s.payload,f.payload,b.number::text,b.hash,b.block_timestamp::text,m.row_key,s.payload->>'poolId',m.payload->'values'->>'memeToken',m.payload->'values'->>'quoteAsset',q.payload->'values'->>'quoteDecimals',q.payload->>'id',m.payload->'values'->>'graduatedHook',k.payload->'values',count(*) OVER()
 FROM tickergarden.canonical_projection_rows s
 JOIN tickergarden.canonical_projection_rows e ON e.chain_id=s.chain_id AND e.table_name='events' AND e.row_key=s.row_key AND e.block_hash=s.block_hash
 LEFT JOIN tickergarden.canonical_projection_rows f ON f.chain_id=s.chain_id AND f.table_name='events' AND f.row_key=s.payload->>'hookFeeEventKey' AND f.block_hash=s.block_hash
 JOIN tickergarden.canonical_projection_rows m ON m.chain_id=s.chain_id AND m.table_name='markets' AND m.payload->'values'->>'poolId'=s.payload->>'poolId'
 JOIN tickergarden.canonical_projection_rows k ON k.chain_id=s.chain_id AND k.table_name='pools' AND k.row_key=m.row_key
 JOIN tickergarden.canonical_projection_rows q ON q.chain_id=s.chain_id AND q.table_name='configs' AND q.row_key='quote:'||(m.payload->'values'->>'quoteAssetConfigId')
 JOIN tickergarden.chain_blocks b ON b.chain_id=s.chain_id AND b.hash=s.block_hash
 WHERE s.chain_id=$1 AND s.row_key=$2 AND s.table_name='swaps' AND b.block_timestamp IS NOT NULL
 AND m.payload->>'marketId'=m.row_key AND k.payload->>'key'=m.row_key
 AND q.payload->>'kind'='quote' AND q.payload->>'id'=m.payload->'values'->>'quoteAssetConfigId'
 AND q.payload->'values'->>'quoteAsset'=m.payload->'values'->>'quoteAsset'
 AND octet_length(k.payload::text)<=65536
 AND octet_length(s.payload::text)<=65536 AND octet_length(e.payload::text)<=65536
 AND (f.payload IS NULL OR octet_length(f.payload::text)<=65536)
 AND NOT EXISTS(SELECT 1 FROM tickergarden.canonical_projection_rows other WHERE other.chain_id=s.chain_id AND other.table_name='swaps' AND other.row_key<>s.row_key AND other.payload->>'hookFeeEventKey'=s.payload->>'hookFeeEventKey')`, chain, eventKey).Scan(&eventRaw, &swapRaw, &feeRaw, &number, &hash, &timestamp, &market, &poolID, &meme, &quote, &decimals, &configID, &hook, &keyRaw, &matches)
	if err != nil || matches != 1 || !hashRE.MatchString(configID) {
		return PoolObservation{}, errPool
	}
	binding, err := resolvePoolBinding(keyRaw, market, poolID, meme, quote, decimals, hook)
	if err != nil {
		return PoolObservation{}, errPool
	}
	out, err := normalizePoolRows(eventRaw, swapRaw, feeRaw, chain, eventKey, binding)
	if err != nil || out.Source.BlockNumber != number || out.Source.BlockHash != hash || (out.FeeSource != nil && out.FeeSource.Emitter != hook) {
		return PoolObservation{}, errPool
	}
	out.BlockTimestamp = timestamp
	out.QuoteAsset, out.MemeToken, out.QuoteConfigID, out.QuoteDecimals = quote, meme, configID, binding.QuoteDecimals
	return out, nil
}

type eventRow struct {
	Provenance CurveSource    `json:"provenance"`
	Signature  string         `json:"signature"`
	Args       map[string]any `json:"args"`
}

func validSource(p CurveSource, chain uint64, key string) bool {
	return p.ChainID == chain && p.EventKey == key && key == fmt.Sprintf("%d:%s:%d", chain, p.TransactionHash, p.LogIndex) && hashRE.MatchString(p.BlockHash) && hashRE.MatchString(p.TransactionHash) && addressRE.MatchString(p.Emitter) && uintRE.MatchString(p.BlockNumber)
}
func normalizePoolRows(eventRaw, swapRaw, feeRaw []byte, chain uint64, key string, b PoolBinding) (PoolObservation, error) {
	var e, f eventRow
	var s struct {
		EventKey        string         `json:"eventKey"`
		PoolID          string         `json:"poolId"`
		Values          map[string]any `json:"values"`
		Provenance      CurveSource    `json:"provenance"`
		HookFeeEventKey string         `json:"hookFeeEventKey"`
		FeeID           string         `json:"feeId"`
	}
	if len(eventRaw) > 65536 || len(swapRaw) > 65536 || len(feeRaw) > 65536 || json.Unmarshal(eventRaw, &e) != nil || json.Unmarshal(swapRaw, &s) != nil || !validSource(e.Provenance, chain, key) || e.Provenance != s.Provenance || s.EventKey != key || s.PoolID != b.PoolID || !reflect.DeepEqual(e.Args, s.Values) {
		return PoolObservation{}, errPool
	}
	sender, ok := e.Args["sender"].(string)
	if !ok || !addressRE.MatchString(sender) || sender == "0x"+strings.Repeat("0", 40) {
		return PoolObservation{}, errPool
	}
	var fee *events.Decoded
	var feeSource *CurveSource
	if s.HookFeeEventKey != "" {
		if json.Unmarshal(feeRaw, &f) != nil || !validSource(f.Provenance, chain, s.HookFeeEventKey) || f.Provenance.BlockNumber != e.Provenance.BlockNumber || f.Provenance.BlockHash != e.Provenance.BlockHash || f.Provenance.TransactionHash != e.Provenance.TransactionHash || f.Provenance.TransactionIndex != e.Provenance.TransactionIndex || f.Provenance.LogIndex <= e.Provenance.LogIndex || !hashRE.MatchString(s.FeeID) || f.Args["feeId"] != s.FeeID {
			return PoolObservation{}, errPool
		}
		nonce, err := uint256(f.Args["feeNonce"])
		if err != nil || nonce.Sign() == 0 || nonce.BitLen() > 64 {
			return PoolObservation{}, errPool
		}
		fee = &events.Decoded{Module: "TickerGardenMemeHook", Signature: f.Signature, Args: f.Args}
		feeSource = &f.Provenance
	} else if len(feeRaw) != 0 || s.FeeID != "" {
		return PoolObservation{}, errPool
	}
	amounts, err := NormalizePoolAmounts(events.Decoded{Module: "UniswapV4PoolManager", Signature: e.Signature, Args: e.Args}, fee, b)
	if err != nil {
		return PoolObservation{}, err
	}
	return PoolObservation{Sender: sender, Source: e.Provenance, FeeSource: feeSource, MarketID: b.MarketID, PoolID: b.PoolID, Amounts: amounts, Classification: "unclassified"}, nil
}

// PoolId is keccak256(abi.encode(PoolKey)); this protocol fixes fee to zero
// and permits only positive tick spacing up to 32767.
func resolvePoolBinding(raw []byte, market, poolID, meme, quote, decimals, hook string) (PoolBinding, error) {
	var k map[string]string
	fail := func() (PoolBinding, error) { return PoolBinding{}, errPool }
	if len(raw) > 65536 || json.Unmarshal(raw, &k) != nil || !hashRE.MatchString(market) || !hashRE.MatchString(poolID) || !addressRE.MatchString(hook) || hook == "0x"+strings.Repeat("0", 40) {
		return fail()
	}
	d, e := strconv.ParseUint(decimals, 10, 8)
	if e != nil || strconv.FormatUint(d, 10) != decimals || d < 6 || d > 18 {
		return fail()
	}
	tick, e := strconv.ParseUint(k["tickSpacing"], 10, 15)
	if e != nil || tick == 0 || strconv.FormatUint(tick, 10) != k["tickSpacing"] || k["fee"] != "0" || k["hooks"] != hook || !addressRE.MatchString(k["currency0"]) || !addressRE.MatchString(k["currency1"]) || k["currency0"] >= k["currency1"] {
		return fail()
	}
	if !addressRE.MatchString(meme) || meme == "0x"+strings.Repeat("0", 40) || !addressRE.MatchString(quote) || meme == quote || (quote == "0x"+strings.Repeat("0", 40) && d != 18) || !((meme == k["currency0"] && quote == k["currency1"]) || (meme == k["currency1"] && quote == k["currency0"])) {
		return fail()
	}
	encoded := make([]byte, 160)
	for i, v := range []string{k["currency0"], k["currency1"], hook} {
		b, _ := hex.DecodeString(v[2:])
		offset := i * 32
		if i == 2 {
			offset = 128
		}
		copy(encoded[offset+12:offset+32], b)
	}
	encoded[126] = byte(tick >> 8)
	encoded[127] = byte(tick)
	if crypto.Keccak256Hash(encoded).Hex() != poolID {
		return fail()
	}
	return PoolBinding{MarketID: market, PoolID: poolID, Currency0: k["currency0"], Currency1: k["currency1"], MemeAsset: meme, QuoteAsset: quote, QuoteDecimals: uint8(d)}, nil
}
