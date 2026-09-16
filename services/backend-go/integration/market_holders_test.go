package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/readmodel"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/analytics"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

func testMarketHolders(t *testing.T, ctx context.Context, pool *pgxpool.Pool, discovered deployment.MarketDiscovery, receipt chainrpc.Receipt, sourceHash string) {
	t.Helper()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	addr := func(n int) string { return fmt.Sprintf("0x%040x", n) }
	// Contract addresses are sorted exactly as the manifest commitment protocol.
	m := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 4663, GenesisHash: hash(110), Contracts: []deployment.Contract{
		{Module: "UniswapV4PoolManager", Address: addr(6), RuntimeCodeHash: hash(6)},
		{Module: "ProtocolFeeVault", Address: addr(7), RuntimeCodeHash: hash(7)},
		{Module: "TreasuryDistributorV1", Address: addr(8), RuntimeCodeHash: hash(8)},
		{Module: "TickerGardenFactoryV1", Address: discovered.Source.Address, RuntimeCodeHash: hash(9)},
	}}
	raw, _ := json.Marshal(m)
	commitment := deployment.Hash(raw)
	original, _ := json.Marshal(discovered)
	// Clone the state map before enriching the fixture's authenticated observation.
	if e := json.Unmarshal(original, &discovered); e != nil {
		t.Fatal(e)
	}
	discovered.State["assetUid"] = hash(0)
	discovered.State["gauge"] = addr(0)
	discovered.State["graduatedHook"] = addr(9)
	discovered.Contracts = []deployment.Contract{{Module: "TickerMemeTokenV1", Address: discovered.State["memeToken"].(string), RuntimeCodeHash: hash(10)}, {Module: "TickerGardenCurve", Address: discovered.State["curve"].(string), RuntimeCodeHash: hash(11)}}
	enriched, _ := json.Marshal(discovered)
	exec(`UPDATE tickergarden.discovered_markets SET payload=$1 WHERE chain_id=4663 AND market_id=$2`, enriched, discovered.MarketID)
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, commitment)
	exec(`INSERT INTO tickergarden.projection_checkpoints(chain_id,manifest_hash,projector_version,start_block,tip_number,tip_hash) VALUES(4663,$1,'holder-test',1,2,$2)`, commitment, sourceHash)
	defer func() {
		exec(`DELETE FROM tickergarden.projection_checkpoints WHERE chain_id=4663`)
		exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, hash(120))
		exec(`UPDATE tickergarden.discovered_markets SET payload=$1 WHERE chain_id=4663 AND market_id=$2`, original, discovered.MarketID)
		exec(`UPDATE tickergarden.chain_blocks SET receipt_count=NULL,receipt_set_hash=NULL WHERE chain_id=4663`)
	}()
	for _, b := range []struct {
		hash string
		rs   []chainrpc.Receipt
	}{{receipt.BlockHash, []chainrpc.Receipt{receipt}}, {sourceHash, []chainrpc.Receipt{}}} {
		digest, e := chainrpc.ReceiptSetCommitment(b.rs)
		if e != nil {
			t.Fatal(e)
		}
		exec(`UPDATE tickergarden.chain_blocks SET receipt_count=$1,receipt_set_hash=$2 WHERE chain_id=4663 AND hash=$3`, len(b.rs), digest, b.hash)
	}
	check := func(ok bool) {
		t.Helper()
		got, e := analytics.LoadMarketHolders(ctx, pool, m, discovered.MarketID)
		if (e == nil) != ok {
			t.Fatal(got, e)
		}
		if ok && (got.TotalSupplyRaw != "100" || got.PositiveAddressCount != 1 || got.IncludedAddressCount != 1 || got.SourceBlockHash != sourceHash || got.SourceBlockNumber != "2" || len(got.Balances) != 1 || got.Balances[0].BalanceRaw != "100") {
			t.Fatal(got)
		}
	}
	check(true)
	global, e := analytics.LoadGlobalHolderCounts(ctx, pool, m)
	if e != nil || global.MarketCount != 1 || global.PositiveAddressCount != 1 || global.IncludedAddressCount != 1 || global.PositiveMarketAddressPairs != 1 || len(global.Groups) != 1 || global.Groups[0].Binding != "unbound" || global.SourceBlockHash != sourceHash {
		t.Fatal(global, e)
	}
	exec(`UPDATE tickergarden.discovered_markets SET payload=jsonb_set(payload,'{state,assetUid}',to_jsonb($1::text)) WHERE chain_id=4663 AND market_id=$2`, hash(999), discovered.MarketID)
	if _, e := analytics.LoadGlobalHolderCounts(ctx, pool, m); e == nil {
		t.Fatal("unknown STOCK binding accepted")
	}
	exec(`UPDATE tickergarden.discovered_markets SET payload=$1 WHERE chain_id=4663 AND market_id=$2`, enriched, discovered.MarketID)
	store, e := analytics.NewCandleStore(pool, m)
	if e != nil {
		t.Fatal(e)
	}
	testFrontendAnalyticsHTTP(t, httpapi.New(httpapi.Options{ChainID: 4663, GlobalHolders: store, Holders: store}), "holders", discovered.MarketID, discovered.State["memeToken"].(string))
	globalRecorder := httptest.NewRecorder()
	httpapi.New(httpapi.Options{ChainID: 4663, GlobalHolders: store}).ServeHTTP(globalRecorder, httptest.NewRequest("GET", "/v1/stats/holders", nil))
	if globalRecorder.Code != 200 {
		t.Fatal(globalRecorder.Code, globalRecorder.Body.String())
	}
	if e := readmodel.ValidateResponse("GlobalHolderCountsResponse", globalRecorder.Body.Bytes()); e != nil {
		t.Fatal(e)
	}
	recorder := httptest.NewRecorder()
	httpapi.New(httpapi.Options{ChainID: 4663, Holders: store}).ServeHTTP(recorder, httptest.NewRequest("GET", "/v1/markets/"+discovered.MarketID+"/holders?limit=1", nil))
	if recorder.Code != 200 {
		t.Fatal(recorder.Code, recorder.Body.String())
	}
	if e := readmodel.ValidateResponse("MarketHoldersResponse", recorder.Body.Bytes()); e != nil {
		t.Fatal(e)
	}
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, hash(0))
	check(false)
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, commitment)
	exec(`UPDATE tickergarden.discovered_markets SET payload=jsonb_set(payload,'{state,memeToken}',to_jsonb($1::text)) WHERE chain_id=4663 AND market_id=$2`, addr(99), discovered.MarketID)
	check(false)
	exec(`UPDATE tickergarden.discovered_markets SET payload=$1 WHERE chain_id=4663 AND market_id=$2`, enriched, discovered.MarketID)
	exec(`UPDATE tickergarden.chain_blocks SET receipt_count=NULL,receipt_set_hash=NULL WHERE chain_id=4663 AND hash=$1`, sourceHash)
	check(false)
	testFrontendAnalyticsHTTP(t, httpapi.New(httpapi.Options{ChainID: 4663, GlobalHolders: store}), "unavailable")
	empty, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{})
	exec(`UPDATE tickergarden.chain_blocks SET receipt_count=0,receipt_set_hash=$1 WHERE chain_id=4663 AND hash=$2`, empty, sourceHash)
	check(true)
}
