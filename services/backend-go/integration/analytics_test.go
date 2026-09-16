package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/analytics"
)

func testCurveAnalytics(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	const chain = 4663
	h := hash(70001)
	key := fmt.Sprintf("%d:%s:7", chain, hash(70002))
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(4663,$1,0,1,$1,1,$1)`, h)
	defer func() {
		for _, sql := range []string{
			`DELETE FROM tickergarden.projection_rows WHERE chain_id=4663`,
			`DELETE FROM tickergarden.projection_checkpoints WHERE chain_id=4663`,
			`DELETE FROM tickergarden.discovery_checkpoints WHERE chain_id=4663`,
			`DELETE FROM tickergarden.chain_blocks WHERE chain_id=4663`,
			`DELETE FROM tickergarden.chain_journal WHERE chain_id=4663`,
		} {
			exec(sql)
		}
	}()
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified,block_timestamp) VALUES(4663,1,$1,$2,true,100)`, h, hash(70000))
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES(4663,$1,0,1,$1)`, h)
	exec(`INSERT INTO tickergarden.projection_checkpoints(chain_id,manifest_hash,projector_version,start_block,tip_number,tip_hash) VALUES(4663,$1,'analytics-test',0,1,$1)`, h)
	source := analytics.CurveSource{ChainID: chain, BlockNumber: "1", BlockHash: h, TransactionHash: hash(70002), LogIndex: 7, Emitter: fmt.Sprintf("0x%040x", 70003), EventKey: key}
	args := map[string]any{"buyer": fmt.Sprintf("0x%040x", 70004), "recipient": fmt.Sprintf("0x%040x", 70005), "quoteIn": "1000000", "tokensOut": "2000000000000000000", "fee": "10000", "tax": "20000"}
	raw, err := json.Marshal(map[string]any{"provenance": source, "signature": "CurveBuy(address,address,uint256,uint256,uint256,uint256)", "args": args})
	if err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(4663,'events',$1,$2,$3)`, key, raw, h)
	args["marketId"] = hash(70006)
	raw, err = json.Marshal(map[string]any{"key": key, "provenance": source, "values": args})
	if err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(4663,'curveTrades',$1,$2,$3)`, key, raw, h)
	configID := hash(70007)
	quoteAsset := fmt.Sprintf("0x%040x", 70008)
	memeToken := fmt.Sprintf("0x%040x", 70009)
	marketRaw, _ := json.Marshal(map[string]any{"marketId": hash(70006), "values": map[string]any{"curve": source.Emitter, "quoteAsset": quoteAsset, "memeToken": memeToken, "quoteAssetConfigId": configID}})
	configRaw, _ := json.Marshal(map[string]any{"kind": "quote", "id": configID, "status": "1", "values": map[string]any{"quoteAsset": quoteAsset, "quoteDecimals": "6"}})
	exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(4663,'markets',$1,$2,$3)`, hash(70006), marketRaw, h)
	exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(4663,'configs',$1,$2,$3)`, "quote:"+configID, configRaw, h)
	check := func(ok bool) {
		t.Helper()
		got, err := analytics.LoadCurveObservation(ctx, pool, chain, key)
		if (err == nil) != ok {
			t.Fatalf("expected available=%v: %+v %v", ok, got, err)
		}
		if ok && (got.QuoteAsset != quoteAsset || got.MemeToken != memeToken || got.QuoteConfigID != configID || got.QuoteDecimals != 6 || got.BlockTimestamp != "100" || got.Source != source || got.Amounts.PriceNumerator != "97" || got.Amounts.PriceDenominator != "200" || got.Classification != "unclassified") {
			t.Fatal(got)
		}
	}
	check(true)
	exec(`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{status}','"2"') WHERE chain_id=4663 AND table_name='configs'`)
	check(true)
	for _, tc := range []struct{ bad, restore string }{
		{`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,quoteDecimals}','"19"') WHERE chain_id=4663 AND table_name='configs'`, `UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,quoteDecimals}','"6"') WHERE chain_id=4663 AND table_name='configs'`},
		{`UPDATE tickergarden.chain_blocks SET block_timestamp=NULL WHERE chain_id=4663`, `UPDATE tickergarden.chain_blocks SET block_timestamp=100 WHERE chain_id=4663`},
		{`UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=4663`, `UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=4663`},
		{`UPDATE tickergarden.chain_blocks SET receipts_verified=false WHERE chain_id=4663`, `UPDATE tickergarden.chain_blocks SET receipts_verified=true WHERE chain_id=4663`},
		{`UPDATE tickergarden.chain_journal SET finalized_number=0 WHERE chain_id=4663`, `UPDATE tickergarden.chain_journal SET finalized_number=1 WHERE chain_id=4663`},
		{`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,quoteIn}','"2"') WHERE chain_id=4663 AND table_name='curveTrades'`, `UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,quoteIn}','"1000000"') WHERE chain_id=4663 AND table_name='curveTrades'`},
	} {
		exec(tc.bad)
		check(false)
		exec(tc.restore)
		check(true)
	}
	for _, tc := range []struct{ table, field, bad, good string }{
		{"markets", "curve", fmt.Sprintf("0x%040x", 90000), source.Emitter},
		{"markets", "quoteAssetConfigId", hash(90001), configID},
		{"configs", "quoteAsset", fmt.Sprintf("0x%040x", 90002), quoteAsset},
		{"markets", "memeToken", "0x0000000000000000000000000000000000000000", memeToken},
	} {
		bad, _ := json.Marshal(tc.bad)
		good, _ := json.Marshal(tc.good)
		exec(`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,$1::text[],$2::jsonb) WHERE chain_id=4663 AND table_name=$3`, []string{"values", tc.field}, bad, tc.table)
		check(false)
		exec(`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,$1::text[],$2::jsonb) WHERE chain_id=4663 AND table_name=$3`, []string{"values", tc.field}, good, tc.table)
		check(true)
	}
	if _, err := analytics.LoadCurveObservation(ctx, pool, 46630, key); err == nil {
		t.Fatal("wrong chain accepted")
	}
	testAnalyticsIndexes(t, ctx, pool, h)
	testPoolAnalytics(t, ctx, pool, h)
	testConversionAnalytics(t, ctx, pool, h)
}
