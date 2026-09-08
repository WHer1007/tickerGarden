package integration

import (
	"context"
	"net/http/httptest"
	"testing"
	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/readmodel"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/analytics"
	"tickergarden/backend/internal/deployment"
)

func testAssetStatistics(t *testing.T, ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, block string) {
	t.Helper()
	asset := hash(73001)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(4663,'configs','asset:'||$1,jsonb_build_object('kind','asset','id',$1::text,'status','2','values',jsonb_build_object('assetUid',$1::text,'stockToken','0x0000000000000000000000000000000000001234','tokenDecimals','8')),$2)`, asset, block)
	exec(`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,assetUid}',to_jsonb($1::text)) WHERE chain_id=4663 AND table_name='markets' AND row_key=ANY($2::text[])`, asset, []string{hash(70006), hash(71001)})
	defer func() {
		exec(`DELETE FROM tickergarden.projection_rows WHERE chain_id=4663 AND table_name='configs' AND row_key='asset:'||$1`, asset)
		exec(`UPDATE tickergarden.projection_rows SET payload=payload#-'{values,assetUid}' WHERE chain_id=4663 AND table_name='markets' AND row_key=ANY($1::text[])`, []string{hash(70006), hash(71001)})
	}()
	check := func(ok bool) {
		t.Helper()
		got, e := analytics.LoadAssetStatistics(ctx, pool, m, asset, 60, 120)
		if (e == nil) != ok {
			t.Fatal(got, e)
		}
		if !ok {
			return
		}
		if got.StockDecimals != 8 || got.StockToken != "0x0000000000000000000000000000000000001234" || len(got.Groups) != 2 {
			t.Fatal(got)
		}
		var curve, poolGroup bool
		for _, g := range got.Groups {
			if g.MarketCount != 1 || g.TradeCount != 1 {
				t.Fatal(g)
			}
			switch g.QuoteDecimals {
			case 6:
				curve = true
				if g.QuoteVolumeRaw != "970000" || len(g.Fees) != 1 || g.Fees[0].FeeRaw != "10000" || g.Fees[0].TaxRaw != "20000" {
					t.Fatal(g)
				}
			case 18:
				poolGroup = true
				if g.InternalTradeCount != 1 || g.InternalQuoteVolumeRaw != "10000" || g.UnknownFeeTradeCount != 1 {
					t.Fatal(g)
				}
			}
		}
		if !curve || !poolGroup {
			t.Fatal(got)
		}
	}
	check(true)
	testGlobalStatistics(t, ctx, pool, m, asset)
	store, err := analytics.NewCandleStore(pool, m)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	httpapi.New(httpapi.Options{ChainID: 4663, AssetStatistics: store}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/assets/"+asset+"/statistics?from=60&to=120", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if err := readmodel.ValidateResponse("AssetStatisticsResponse", w.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,tokenDecimals}','"19"') WHERE chain_id=4663 AND table_name='configs' AND row_key='asset:'||$1`, asset)
	check(false)
	exec(`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,tokenDecimals}','"8"') WHERE chain_id=4663 AND table_name='configs' AND row_key='asset:'||$1`, asset)
	check(true)
	exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(4663,'markets',$1,jsonb_build_object('marketId',$1::text,'values',jsonb_build_object('assetUid',$2::text)),$3)`, hash(73003), asset, block)
	check(false)
	exec(`DELETE FROM tickergarden.projection_rows WHERE chain_id=4663 AND table_name='markets' AND row_key=$1`, hash(73003))
	check(true)
	if _, e := analytics.LoadAssetStatistics(ctx, pool, m, hash(73004), 60, 120); e == nil {
		t.Fatal("unregistered STOCK accepted")
	}
}
