package integration

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/analytics"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/readmodel"
	"time"
)

func testAnalyticsCoverage(t *testing.T, ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, block string) {
	t.Helper()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES(4663,0,$1,$2,40,true),(4663,2,$3,$4,120,true)`, hash(70000), hash(0), hash(72002), block)
	exec(`UPDATE tickergarden.projection_checkpoints SET tip_number=2,tip_hash=$1 WHERE chain_id=4663`, hash(72002))
	exec(`UPDATE tickergarden.discovery_checkpoints SET tip_number=2,tip_hash=$1 WHERE chain_id=4663`, hash(72002))
	exec(`UPDATE tickergarden.chain_journal SET finalized_number=2,finalized_hash=$1 WHERE chain_id=4663`, hash(72002))
	defer func() {
		exec(`UPDATE tickergarden.projection_checkpoints SET tip_number=1,tip_hash=$1 WHERE chain_id=4663`, block)
		exec(`UPDATE tickergarden.discovery_checkpoints SET tip_number=1,tip_hash=$1 WHERE chain_id=4663`, block)
		exec(`UPDATE tickergarden.chain_journal SET finalized_number=1,finalized_hash=$1 WHERE chain_id=4663`, block)
		exec(`DELETE FROM tickergarden.chain_blocks WHERE chain_id=4663 AND number IN (0,2)`)
	}()
	check := func(from, to uint64, ok bool) {
		t.Helper()
		tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		got, err := analytics.VerifyRangeCoverage(ctx, tx, m, from, to)
		if (err == nil) != ok {
			t.Fatalf("coverage=%v got=%+v err=%v", ok, got, err)
		}
		if ok && (got.AnchorNumber != 0 || got.ThroughNumber != 2 || got.ThroughHash != hash(72002) || got.ProjectionNumber != 2) {
			t.Fatal(got)
		}
	}
	check(60, 120, true)
	testAssetStatistics(t, ctx, pool, m, block)
	candles, err := analytics.LoadMarketCandles(ctx, pool, m, hash(70006), 60, 120, 60)
	if err != nil || len(candles.Series.Candles) != 1 {
		t.Fatal(candles, err)
	}
	candle := candles.Series.Candles[0]
	if candle.TradeCount != 1 || candle.Open == nil || candle.Open.Numerator != "97" || candle.Open.Denominator != "200" || candle.QuoteVolumeRaw != "970000" || candle.InternalTradeCount != 0 {
		t.Fatal(candle)
	}

	candleStore, e := analytics.NewCandleStore(pool, m)
	if e != nil {
		t.Fatal(e)
	}
	recorder := httptest.NewRecorder()
	httpapi.New(httpapi.Options{ChainID: 4663, Candles: candleStore}).ServeHTTP(recorder, httptest.NewRequest("GET", "/v1/markets/"+hash(70006)+"/candles?interval=1m&from=60&to=120", nil))
	if e := readmodel.ValidateResponse("MarketCandlesResponse", recorder.Body.Bytes()); e != nil {
		t.Fatal(e)
	}

	tradeRecorder := httptest.NewRecorder()
	httpapi.New(httpapi.Options{ChainID: 4663, Trades: candleStore}).ServeHTTP(tradeRecorder, httptest.NewRequest("GET", "/v1/markets/"+hash(71001)+"/trades?from=60&to=120&limit=1", nil))
	if e := readmodel.ValidateResponse("MarketTradesResponse", tradeRecorder.Body.Bytes()); e != nil {
		t.Fatal(e)
	}
	curveTradeRecorder := httptest.NewRecorder()
	httpapi.New(httpapi.Options{ChainID: 4663, Trades: candleStore}).ServeHTTP(curveTradeRecorder, httptest.NewRequest("GET", "/v1/markets/"+hash(70006)+"/trades?from=60&to=120", nil))
	if curveTradeRecorder.Code != 200 {
		t.Fatal(curveTradeRecorder.Code)
	}
	if e := readmodel.ValidateResponse("MarketTradesResponse", curveTradeRecorder.Body.Bytes()); e != nil {
		t.Fatal(e)
	}
	var tradePage analytics.TradePage
	if tradeRecorder.Code != 200 || json.Unmarshal(tradeRecorder.Body.Bytes(), &tradePage) != nil || len(tradePage.Items) != 1 || tradePage.Items[0].Classification != "internal_reward_conversion" || tradePage.NextCursor != nil {
		t.Fatal(tradeRecorder.Code, tradeRecorder.Body.String())
	}
	var payload analytics.MarketCandles
	if recorder.Code != 200 || json.Unmarshal(recorder.Body.Bytes(), &payload) != nil || len(payload.Series.Candles) != 1 || payload.Series.Candles[0].QuoteVolumeRaw != "970000" {
		t.Fatal(recorder.Code, recorder.Body.String())
	}

	activities, e := analytics.LoadMarketTrades(ctx, pool, m, hash(70006), 60, 120)
	if e != nil || len(activities.Items) != 1 {
		t.Fatal(activities, e)
	}
	item := activities.Items[0]
	if item.Venue != "curve" || item.Actor == nil || item.ActorConfidence != "contract_caller_not_verified_wallet" || item.QuoteRaw != "970000" || item.FeeRaw == nil || *item.FeeRaw != "10000" || item.TaxRaw == nil || *item.TaxRaw != "20000" {
		t.Fatal(item)
	}
	conversions, e := analytics.LoadMarketTrades(ctx, pool, m, hash(71001), 60, 120)
	if e != nil || len(conversions.Items) != 1 {
		t.Fatal(conversions, e)
	}
	ci := conversions.Items[0]
	if ci.Classification != "internal_reward_conversion" || ci.Actor == nil || *ci.Actor != "0x0000000000000000000000000000000000000003" || ci.ActorConfidence != "contract_caller_not_verified_wallet" || ci.Venue != "pool" || ci.MemeRaw != "1000" || ci.QuoteRaw != "10000" || ci.Source.LogIndex != 200 {
		t.Fatal(ci)
	}
	poolCandles, e := analytics.LoadMarketCandles(ctx, pool, m, hash(71001), 60, 120, 60)
	if e != nil || len(poolCandles.Series.Candles) != 1 {
		t.Fatal(poolCandles, e)
	}
	pc := poolCandles.Series.Candles[0]
	if pc.TradeCount != 1 || pc.InternalTradeCount != 1 || pc.InternalQuoteVolumeRaw != "10000" || pc.Open == nil || pc.Open.Numerator != "10" {
		t.Fatal(pc)
	}
	func() {
		exec(`UPDATE tickergarden.chain_blocks SET block_timestamp=CASE number WHEN 1 THEN 3700 WHEN 2 THEN 90000 ELSE block_timestamp END WHERE chain_id=4663 AND number IN (1,2)`)
		defer exec(`UPDATE tickergarden.chain_blocks SET block_timestamp=CASE number WHEN 1 THEN 100 WHEN 2 THEN 120 ELSE block_timestamp END WHERE chain_id=4663 AND number IN (1,2)`)
		handler := httpapi.New(httpapi.Options{ChainID: 4663, Trades: candleStore, Candles: candleStore})
		identities := []map[string]any{}
		for _, market := range []analytics.MarketTrades{activities, conversions} {
			identities = append(identities, map[string]any{"marketId": market.MarketID, "memeAsset": market.MemeAsset, "quoteAsset": market.QuoteAsset, "quoteDecimals": market.QuoteDecimals})
		}
		encoded, e := json.Marshal(identities)
		if e != nil {
			t.Fatal(e)
		}
		testFrontendAnalyticsHTTP(t, handler, "market-history", string(encoded))
		exec(`UPDATE tickergarden.chain_blocks SET receipts_verified=false WHERE chain_id=4663 AND number=1`)
		testFrontendAnalyticsHTTP(t, handler, "market-history-unavailable", string(encoded))
		exec(`UPDATE tickergarden.chain_blocks SET receipts_verified=true WHERE chain_id=4663 AND number=1`)
		testFrontendAnalyticsHTTP(t, handler, "market-history", string(encoded))
	}()
	if _, err = analytics.LoadMarketCandles(ctx, pool, m, hash(70006), 60, 180, 60); err == nil {
		t.Fatal("uncovered range returned candles")
	}
	exec(`UPDATE tickergarden.projection_rows SET table_name='poolEvents' WHERE chain_id=4663 AND table_name='curveTrades'`)
	if _, err = analytics.LoadMarketCandles(ctx, pool, m, hash(70006), 60, 120, 60); err == nil {
		t.Fatal("missing trade projection returned candles")
	}
	exec(`UPDATE tickergarden.projection_rows SET table_name='curveTrades' WHERE chain_id=4663 AND table_name='poolEvents'`)

	check(60, 121, false)
	check(40, 120, false)
	check(120, 60, false)
	for _, tc := range []struct{ sql, restore string }{
		{`UPDATE tickergarden.chain_blocks SET receipts_verified=false WHERE chain_id=4663 AND number=1`, `UPDATE tickergarden.chain_blocks SET receipts_verified=true WHERE chain_id=4663 AND number=1`},
		{`UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=4663 AND number=1`, `UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=4663 AND number=1`},
		{`UPDATE tickergarden.chain_blocks SET block_timestamp=NULL WHERE chain_id=4663 AND number=1`, `UPDATE tickergarden.chain_blocks SET block_timestamp=100 WHERE chain_id=4663 AND number=1`},
		{`UPDATE tickergarden.chain_blocks SET block_timestamp=130 WHERE chain_id=4663 AND number=1`, `UPDATE tickergarden.chain_blocks SET block_timestamp=100 WHERE chain_id=4663 AND number=1`},
		{`UPDATE tickergarden.chain_journal SET finalized_number=1 WHERE chain_id=4663`, `UPDATE tickergarden.chain_journal SET finalized_number=2 WHERE chain_id=4663`},
	} {
		exec(tc.sql)
		check(60, 120, false)
		exec(tc.restore)
		check(60, 120, true)
	}
	exec(`UPDATE tickergarden.chain_blocks SET parent_hash=$1 WHERE chain_id=4663 AND number=1`, hash(99))
	check(60, 120, false)
	exec(`UPDATE tickergarden.chain_blocks SET parent_hash=$1 WHERE chain_id=4663 AND number=1`, hash(70000))
	check(60, 120, true)
	// Validate the optimized SQL hash predicate against malformed prefixes,
	// lengths, uppercase digits, whitespace, and non-ASCII characters.
	for _, value := range []string{hash(0), "0x" + strings.Repeat("f", 64), "", "0X" + strings.Repeat("f", 64), "0x" + strings.Repeat("F", 64), "0x" + strings.Repeat("g", 64), hash(0) + "\n", hash(0)[:65], "0x" + strings.Repeat("é", 64)} {
		var exact, optimized bool
		e := pool.QueryRow(ctx, `SELECT $1::text ~ '^0x[0-9a-f]{64}$', length($1::text)=66 AND left($1::text,2)='0x' AND translate(substr($1::text,3),'0123456789abcdef','')=''`, value).Scan(&exact, &optimized)
		if e != nil || exact != optimized {
			t.Fatal("hash predicate mismatch", value, exact, optimized, e)
		}
	}
	// The full proof is evaluated in PostgreSQL, including histories longer than
	// the former 100000-height Go transfer bound.
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified)
 SELECT 4663,n,'0x'||repeat(md5('coverage-'||n::text),2),
 CASE WHEN n=3 THEN $1 ELSE '0x'||repeat(md5('coverage-'||(n-1)::text),2) END,
 120+(n-2)*2,true FROM generate_series(3,100003) n`, hash(72002))
	exec(`UPDATE tickergarden.projection_checkpoints SET tip_number=100003,tip_hash='0x'||repeat(md5('coverage-100003'),2) WHERE chain_id=4663`)
	exec(`UPDATE tickergarden.discovery_checkpoints SET tip_number=100003,tip_hash='0x'||repeat(md5('coverage-100003'),2) WHERE chain_id=4663`)
	exec(`UPDATE tickergarden.chain_journal SET finalized_number=100003,finalized_hash='0x'||repeat(md5('coverage-100003'),2) WHERE chain_id=4663`)
	defer func() {
		exec(`UPDATE tickergarden.projection_checkpoints SET tip_number=2,tip_hash=$1 WHERE chain_id=4663`, hash(72002))
		exec(`UPDATE tickergarden.discovery_checkpoints SET tip_number=2,tip_hash=$1 WHERE chain_id=4663`, hash(72002))
		exec(`UPDATE tickergarden.chain_journal SET finalized_number=2,finalized_hash=$1 WHERE chain_id=4663`, hash(72002))
		exec(`DELETE FROM tickergarden.chain_blocks WHERE chain_id=4663 AND number>=3`)
	}()
	verifyLong := func(ok bool) {
		t.Helper()
		tx, e := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(ctx)
		queryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		started := time.Now()
		proof, e := analytics.VerifyRangeCoverage(queryCtx, tx, m, 60, 120)
		t.Logf("long coverage readable=%v duration=%s", ok, time.Since(started))
		if (e == nil) != ok {
			t.Fatal(proof, e)
		}
		if ok && (proof.ProjectionNumber != 100003 || proof.ThroughNumber != 2) {
			t.Fatal(proof)
		}
	}
	verifyLong(true)
	exec(`UPDATE tickergarden.chain_blocks SET receipts_verified=false WHERE chain_id=4663 AND number=99999`)
	verifyLong(false)
	exec(`UPDATE tickergarden.chain_blocks SET receipts_verified=true WHERE chain_id=4663 AND number=99999`)

}
