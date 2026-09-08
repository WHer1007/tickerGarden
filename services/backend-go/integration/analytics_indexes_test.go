package integration

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"testing"
)

func testAnalyticsIndexes(t *testing.T, ctx context.Context, pool *pgxpool.Pool, block string) {
	t.Helper()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	// Distinct emitters/pools provide realistic selectivity without planner flags.
	exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash)
 SELECT 4663,'events','index-fixture:'||n,
 CASE WHEN n%2=0 THEN jsonb_build_object('signature','CurveBuy(address,address,uint256,uint256,uint256,uint256)','provenance',jsonb_build_object('emitter','0x'||lpad(to_hex(n),40,'0')))
 ELSE jsonb_build_object('signature','Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)','args',jsonb_build_object('id','0x'||lpad(to_hex(n),64,'0'))) END,$1
 FROM generate_series(1,20000) n`, block)
	defer exec(`DELETE FROM tickergarden.projection_rows WHERE chain_id=4663 AND row_key LIKE 'index-fixture:%'`)
	exec(`ANALYZE tickergarden.projection_rows`)
	for _, tc := range []struct{ predicate, index, key string }{
		{`payload->'provenance'->>'emitter'='0x0000000000000000000000000000000000000002' AND payload->>'signature' IN ('CurveBuy(address,address,uint256,uint256,uint256,uint256)','CurveSell(address,address,uint256,uint256,uint256,uint256)')`, "projection_curve_execution_lookup", "index-fixture:2"},
		{`payload->'args'->>'id'='0x0000000000000000000000000000000000000000000000000000000000000003' AND payload->>'signature'='Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'`, "projection_pool_execution_lookup", "index-fixture:3"},
	} {
		query := `SELECT row_key FROM tickergarden.canonical_projection_rows WHERE chain_id=4663 AND table_name='events' AND ` + tc.predicate
		var plan []byte
		if e := pool.QueryRow(ctx, "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+query).Scan(&plan); e != nil {
			t.Fatal(e)
		}
		var parsed any
		if json.Unmarshal(plan, &parsed) != nil || !strings.Contains(string(plan), tc.index) {
			t.Fatalf("selective canonical lookup did not use %s: %s", tc.index, plan)
		}
		var key string
		if e := pool.QueryRow(ctx, query).Scan(&key); e != nil || key != tc.key {
			t.Fatal(key, e)
		}
		t.Logf("canonical analytics lookup uses %s", tc.index)
	}
	var blockPlan []byte
	if e := pool.QueryRow(ctx, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT 1 FROM tickergarden.projection_rows WHERE chain_id=4663 AND block_hash=$1`, hash(0)).Scan(&blockPlan); e != nil || !strings.Contains(string(blockPlan), "projection_rows_block_lookup") {
		t.Fatal("block lookup index not used", string(blockPlan), e)
	}
	t.Log("projection block foreign-key lookup uses projection_rows_block_lookup")
	// All new indexes must survive normal migration startup.
	var count int
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM pg_indexes WHERE schemaname='tickergarden' AND indexname IN ('projection_curve_execution_lookup','projection_pool_execution_lookup','projection_market_pool_lookup','projection_swap_fee_lookup')`).Scan(&count); e != nil || count != 4 {
		t.Fatal(count, e)
	}
}
