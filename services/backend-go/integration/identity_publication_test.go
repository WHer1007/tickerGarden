package integration

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/readmodel"
)

func testIdentityPublication(t *testing.T, ctx context.Context, pool *pgxpool.Pool, chain uint64, market, token, blockHash string, source chainrpc.Log) {
	t.Helper()
	raw, e := os.ReadFile("../internal/readmodel/testdata/snapshot.json")
	if e != nil {
		t.Fatal(e)
	}
	base, e := readmodel.Parse(raw, 46630)
	if e != nil {
		t.Fatal(e)
	}
	m := base.Markets[0]
	m.MarketID = market
	m.MemeToken = token
	if m.PoolKey != nil {
		key := *m.PoolKey
		key.Currency0 = m.QuoteAsset
		key.Currency1 = token
		if key.Currency0 > key.Currency1 {
			key.Currency0, key.Currency1 = key.Currency1, key.Currency0
		}
		m.PoolKey = &key
	}
	m.Source = readmodel.SourceBlock{ChainID: chain, BlockNumber: "1", BlockHash: blockHash, TransactionHash: source.TransactionHash, TransactionIndex: 0, LogIndex: 0}
	base.Markets = []readmodel.MarketReadModel{m}
	base.Configs = []readmodel.ConfigReadModel{}
	base.Positions = []readmodel.UserPositionReadModel{}
	number, lag := "1", "0"
	base.Sync.ChainID = chain
	base.Sync.BlockNumber = &number
	base.Sync.BlockHash = &blockHash
	base.Sync.HeadBlockNumber = &number
	base.Sync.HeadBlockHash = &blockHash
	base.Sync.LagBlocks = &lag
	base.Sync.Revision = "1:" + blockHash
	raw, _ = json.Marshal(base)
	store := readmodel.Store{Pool: pool, ChainID: chain}
	enriched, e := store.EnrichIdentities(ctx, raw)
	if e != nil {
		t.Fatal("enrich snapshot", e)
	}
	var got readmodel.Snapshot
	if e = json.Unmarshal(enriched, &got); e != nil || got.Markets[0].Identity == nil || got.Markets[0].Identity.Symbol != "PERSIST" {
		t.Fatal("missing enriched identity", e)
	}
	good := got.Markets[0].Identity.Name
	got.Markets[0].Identity.Name = "spoofed"
	bad, _ := json.Marshal(got)
	if e = store.Publish(ctx, bad, time.Now()); e == nil {
		t.Fatal("unverified display identity published")
	}
	if _, e = store.EnrichIdentities(ctx, bad); e == nil {
		t.Fatal("spoofed input silently overwritten")
	}
	got.Markets[0].Identity.Name = good
	if e = store.Publish(ctx, enriched, time.Now()); e != nil {
		t.Fatal("enriched publication", e)
	}
	loaded, e := store.Load(ctx, base.Sync.Revision)
	if e != nil || loaded.Markets[0].Identity == nil || loaded.Markets[0].Identity.Name != good {
		t.Fatal("published identity lost", e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=$2`, hash(998), chain); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Load(ctx, base.Sync.Revision); e == nil {
		t.Fatal("invalid identity source accepted in pinned snapshot")
	}
}
