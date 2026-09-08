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

func testGlobalStatistics(t *testing.T, ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, asset string) {
	t.Helper()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	// The separate Pool fixture has no asset binding and must not be silently skipped.
	if _, err := analytics.LoadGlobalStatistics(ctx, pool, m, 60, 120); err == nil {
		t.Fatal("incomplete market silently omitted")
	}
	var payload []byte
	var block string
	if err := pool.QueryRow(ctx, `SELECT payload,block_hash FROM tickergarden.projection_rows WHERE chain_id=4663 AND table_name='markets' AND row_key=$1`, hash(70103)).Scan(&payload, &block); err != nil {
		t.Fatal(err)
	}
	exec(`DELETE FROM tickergarden.projection_rows WHERE chain_id=4663 AND table_name='markets' AND row_key=$1`, hash(70103))
	defer func() {
		exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(4663,'markets',$1,$2,$3)`, hash(70103), payload, block)
		exec(`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,assetUid}',to_jsonb($1::text)) WHERE chain_id=4663 AND table_name='markets' AND row_key=$2`, asset, hash(70006))
	}()
	check := func(unbound uint64) {
		t.Helper()
		got, err := analytics.LoadGlobalStatistics(ctx, pool, m, 60, 120)
		if err != nil || got.MarketCount != 2 || got.RegisteredStockCount != 1 || got.BoundMarketCount != 2-unbound || got.UnboundMarketCount != unbound || len(got.Groups) != 2 || len(got.Stocks) != 1 || got.Stocks[0].AssetUID != asset {
			t.Fatal(got, err)
		}
		var unboundGroups uint64
		for _, g := range got.Groups {
			if g.Binding == "unbound" {
				unboundGroups++
				if g.AssetUID != hash(0) {
					t.Fatal(g)
				}
			} else if g.Binding != "registered_stock" || g.AssetUID != asset {
				t.Fatal(g)
			}
			if g.MarketCount != 1 || g.TradeCount != 1 {
				t.Fatal(g)
			}
			switch g.QuoteDecimals {
			case 6:
				if g.QuoteVolumeRaw != "970000" {
					t.Fatal(g)
				}
			case 18:
				if g.InternalQuoteVolumeRaw != "10000" {
					t.Fatal(g)
				}
			default:
				t.Fatal(g)
			}
		}
		if unboundGroups != unbound {
			t.Fatal(got)
		}
	}
	check(0)
	series, e := analytics.LoadGlobalFlowSeries(ctx, pool, m, 60, 120, 60)
	if e != nil || len(series.Points) != 1 || len(series.Points[0].Groups) != 2 || series.Coverage.From != 60 || series.Coverage.To != 120 {
		t.Fatal(series, e)
	}
	for _, g := range series.Points[0].Groups {
		if g.TradeCount != 1 {
			t.Fatal(g)
		}
	}
	store, e := analytics.NewCandleStore(pool, m)
	if e != nil {
		t.Fatal(e)
	}
	testFrontendAnalyticsHTTP(t, httpapi.New(httpapi.Options{ChainID: 4663, GlobalStatistics: store}), "overview")
	// Give the authenticated fixture a complete 24-hour time window, then restore
	// its original timestamps before the shorter-window regression cases.
	func() {
		exec(`UPDATE tickergarden.chain_blocks SET block_timestamp=CASE number WHEN 1 THEN 3700 WHEN 2 THEN 90000 ELSE block_timestamp END WHERE chain_id=4663 AND number IN (1,2)`)
		defer exec(`UPDATE tickergarden.chain_blocks SET block_timestamp=CASE number WHEN 1 THEN 100 WHEN 2 THEN 120 ELSE block_timestamp END WHERE chain_id=4663 AND number IN (1,2)`)
		day, err := analytics.LoadGlobalFlowSeries(ctx, pool, m, 3600, 90000, 3600)
		if err != nil || len(day.Points) != 24 || len(day.Points[0].Groups) != 2 {
			t.Fatal(day, err)
		}
		for index, point := range day.Points {
			if point.Timestamp != 3600+uint64(index)*3600 || len(point.Groups) != 2 {
				t.Fatal(point)
			}
			for _, group := range point.Groups {
				if index == 0 && group.TradeCount != 1 {
					t.Fatal(group)
				}
				if index > 0 && (group.TradeCount != 0 || group.QuoteVolumeRaw != "0" || len(group.Fees) != 0) {
					t.Fatal(group)
				}
			}
		}
		handler := httpapi.New(httpapi.Options{ChainID: 4663, GlobalSeries: store})
		testFrontendAnalyticsHTTP(t, handler, "series")
		exec(`UPDATE tickergarden.chain_blocks SET block_timestamp=89999 WHERE chain_id=4663 AND number=2`)
		if _, err := analytics.LoadGlobalFlowSeries(ctx, pool, m, 3600, 90000, 3600); err == nil {
			t.Fatal("incomplete final hour accepted")
		}
		testFrontendAnalyticsHTTP(t, handler, "series-unavailable")
	}()
	seriesRecorder := httptest.NewRecorder()
	httpapi.New(httpapi.Options{ChainID: 4663, GlobalSeries: store}).ServeHTTP(seriesRecorder, httptest.NewRequest("GET", "/v1/stats/series?interval=1m&from=60&to=120", nil))
	if seriesRecorder.Code != 200 {
		t.Fatal(seriesRecorder.Code, seriesRecorder.Body.String())
	}
	if e := readmodel.ValidateResponse("GlobalFlowSeriesResponse", seriesRecorder.Body.Bytes()); e != nil {
		t.Fatal(e)
	}
	w := httptest.NewRecorder()
	httpapi.New(httpapi.Options{ChainID: 4663, GlobalStatistics: store}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/stats/overview?from=60&to=120", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if e := readmodel.ValidateResponse("GlobalStatisticsResponse", w.Body.Bytes()); e != nil {
		t.Fatal(e)
	}
	exec(`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,assetUid}',to_jsonb($1::text)) WHERE chain_id=4663 AND table_name='markets' AND row_key=$2`, hash(0), hash(70006))
	check(1)
	exec(`UPDATE tickergarden.projection_rows SET payload=jsonb_set(payload,'{values,assetUid}',to_jsonb($1::text)) WHERE chain_id=4663 AND table_name='markets' AND row_key=$2`, hash(999999), hash(70006))
	if _, err := analytics.LoadGlobalStatistics(ctx, pool, m, 60, 120); err == nil {
		t.Fatal("unregistered binding accepted")
	}
}
