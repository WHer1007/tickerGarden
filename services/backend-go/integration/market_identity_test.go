package integration

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/marketidentity"
	"tickergarden/backend/internal/treasury"
)

func testMarketIdentity(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	const chain = 421614
	address := func(n int) string { return fmt.Sprintf("0x%040x", n) }
	market, creation := hash(310), hash(311)
	c := treasury.Candidate{Input: treasury.Input{Context: treasury.Context{MarketID: market, MemeToken: address(313), QuoteToken: address(314), Distributor: address(315), SourceBlockNumber: "1", SourceBlockHash: creation}, SourceBlockTimestamp: "100"}, Journal: treasury.JournalEvidence{ChainID: chain}, Request: deployment.TreasuryRequestSnapshot{BlockNumber: "0x1", BlockHash: creation}}
	rpc := discoveryRPC(c)
	rpc.block.Timestamp = "0x64"
	roots := map[string]string{}
	for _, v := range rpc.manifest.Contracts {
		roots[v.Module] = v.Address
	}
	word := func(v string) []byte {
		b, e := hex.DecodeString(fmt.Sprintf("%064s", v))
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	raw := make([]byte, 20*32)
	put := func(i int, v string) { copy(raw[i*32:(i+1)*32], word(v)) }
	for _, i := range []int{1, 2, 3, 4, 6} {
		put(i, "1")
	}
	put(5, deployment.Hash([]byte("V1-EXEC-11"))[2:])
	put(8, address(312)[2:])
	put(9, c.Input.MemeToken[2:])
	put(10, address(316)[2:])
	put(12, c.Input.QuoteToken[2:])
	put(13, address(0x2044)[2:])
	put(18, "1")
	rpc.calls[roots["MarketRegistryV1"]+deployment.Hash([]byte("market(bytes32)"))[:10]+market[2:]] = raw
	rpc.calls[roots["MarketRegistryV1"]+deployment.Hash([]byte("marketIdByToken(address)"))[:10]+fmt.Sprintf("%064s", c.Input.MemeToken[2:])] = word(market[2:])
	key := func(sig string) string { return c.Input.MemeToken + deployment.Hash([]byte(sig))[:10] }
	rpc.calls[key("marketId()")] = word(market[2:])
	rpc.calls[key("factory()")] = word(roots["TickerGardenFactoryV1"][2:])
	rpc.calls[key("deployedAt()")] = word("64")
	stringABI := func(s string) []byte {
		b := make([]byte, 64+((len(s)+31)/32)*32)
		b[31] = 32
		binary.BigEndian.PutUint64(b[56:64], uint64(len(s)))
		copy(b[64:], s)
		return b
	}
	rpc.calls[key("name()")] = stringABI("持久市场")
	rpc.calls[key("symbol()")] = stringABI("PERSIST")
	rpc.calls[key("metadataURI()")] = stringABI("ipfs://example")
	mh, e := marketidentity.ManifestHash(rpc.manifest)
	if e != nil {
		t.Fatal(e)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec(`UPDATE tickergarden.chain_journal SET genesis_hash=$1,start_block=1,tip_number=1,tip_hash=$2,finalized_number=1,finalized_hash=$2 WHERE chain_id=$3`, rpc.manifest.GenesisHash, creation, chain)
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES($1,1,$2,$3,100,true)`, chain, creation, rpc.manifest.GenesisHash)
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES($1,$2,1,1,$3)`, chain, mh, creation)
	exec(`INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES($1,$2)`, chain, creation)
	source := chainrpc.Log{Address: roots["TickerGardenFactoryV1"], BlockHash: creation, BlockNumber: "0x1", LogIndex: "0x0", TransactionIndex: "0x0", TransactionHash: hash(312)}
	log, _ := json.Marshal(source)
	exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,0,$3,$4)`, chain, creation, source.Address, log)
	discovery := deployment.MarketDiscovery{MarketID: market, Source: source, State: map[string]any{"memeToken": c.Input.MemeToken}, Contracts: []deployment.Contract{{Module: "TickerMemeTokenV1", Address: c.Input.MemeToken, RuntimeCodeHash: deployment.Hash([]byte{0})}}}
	payload, _ := json.Marshal(discovery)
	exec(`INSERT INTO tickergarden.discovered_markets(chain_id,block_hash,market_id,log_index,payload) VALUES($1,$2,$3,0,$4)`, chain, creation, market, payload)
	worker := marketidentity.Worker{Pool: pool, RPC: rpc, Manifest: rpc.manifest}
	rpc.calls[key("deployedAt()")] = word("63")
	if _, e = worker.Step(ctx); e == nil {
		t.Fatal("wrong creation timestamp persisted")
	}
	var count int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.market_identities`).Scan(&count); e != nil || count != 0 {
		t.Fatal("partial identity persisted", e)
	}
	rpc.calls[key("deployedAt()")] = word("64")
	held, e := pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer held.Rollback(context.Background())
	if _, e = held.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, int64(730000000+chain)); e != nil {
		t.Fatal(e)
	}
	busy, e := worker.Step(ctx)
	if e != nil || busy.Action != "busy" {
		t.Fatal("concurrent writer lock", busy, e)
	}
	if e = held.Rollback(ctx); e != nil {
		t.Fatal(e)
	}
	result, e := worker.Step(ctx)
	if e != nil || result.Action != "observed" || result.MarketID != market {
		t.Fatal(result, e)
	}
	result, e = worker.Step(ctx)
	if e != nil || result.Action != "idle" {
		t.Fatal("duplicate worker run", result, e)
	}
	loaded, e := marketidentity.LoadAt(ctx, pool, chain, market, creation)
	if e != nil || loaded.Symbol != "PERSIST" {
		t.Fatal("snapshot-bound identity read", loaded, e)
	}
	testMarketIdentityBatch(t, ctx, pool, loaded, mh, source)
	if _, e = marketidentity.LoadAt(ctx, pool, chain, market, hash(999)); e == nil {
		t.Fatal("unknown snapshot accepted")
	}
	if got, err := marketidentity.LoadManyAt(ctx, pool, chain, []string{market}, hash(999)); err == nil || got != nil {
		t.Fatal("batch: unknown snapshot accepted")
	}
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES($1,0,$2,$3,0,true)`, chain, rpc.manifest.GenesisHash, hash(0))
	if _, e = marketidentity.LoadAt(ctx, pool, chain, market, rpc.manifest.GenesisHash); e == nil {
		t.Fatal("future creation leaked into older snapshot")
	}
	if got, err := marketidentity.LoadManyAt(ctx, pool, chain, []string{market}, rpc.manifest.GenesisHash); err == nil || got != nil {
		t.Fatal("batch: future creation leaked into older snapshot")
	}
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=$2`, hash(999), chain)
	if _, e = marketidentity.LoadAt(ctx, pool, chain, market, creation); e == nil {
		t.Fatal("wrong discovery scope visible")
	}
	if got, err := marketidentity.LoadManyAt(ctx, pool, chain, []string{market}, creation); err == nil || got != nil {
		t.Fatal("batch: wrong discovery scope visible")
	}
	if _, e = worker.Step(ctx); e == nil {
		t.Fatal("wrong discovery manifest accepted")
	}
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=$2`, mh, chain)
	var stored []byte
	if e = pool.QueryRow(ctx, `SELECT payload FROM tickergarden.canonical_market_identities WHERE chain_id=$1`, chain).Scan(&stored); e != nil {
		t.Fatal(e)
	}
	var identity deployment.MarketIdentity
	if json.Unmarshal(stored, &identity) != nil || identity.Name != "持久市场" || identity.DeployedAt != "100" || identity.BlockHash != creation {
		t.Fatal("stored identity mismatch")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.market_identities SET payload=payload WHERE chain_id=$1`, chain); e == nil {
		t.Fatal("identity mutable")
	}
	exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=$1`, chain)
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.canonical_market_identities WHERE chain_id=$1`, chain).Scan(&count); e != nil || count != 0 {
		t.Fatal("orphaned identity visible", count, e)
	}
	if _, e = marketidentity.LoadAt(ctx, pool, chain, market, creation); e == nil {
		t.Fatal("orphaned identity returned to snapshot reader")
	}
	if got, err := marketidentity.LoadManyAt(ctx, pool, chain, []string{market}, creation); err == nil || got != nil {
		t.Fatal("batch: orphaned identity returned to snapshot reader")
	}
	if _, e = worker.Step(ctx); e == nil {
		t.Fatal("invalidated checkpoint accepted")
	}
	exec(`UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=$1`, chain)
	testIdentityPublication(t, ctx, pool, chain, market, c.Input.MemeToken, creation, source)

}
