package observationwork

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

// Opt-in read-only comparison at a locally journaled canonical block. No signer.
func TestLiveScopedEquivalence(t *testing.T) {
	if os.Getenv("TG_TEST_OBSERVATION_LIVE") != "1" {
		t.Skip("opt-in archive RPC equivalence")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	raw, e := os.ReadFile(os.Getenv("TG_DEPLOYMENT_MANIFEST"))
	if e != nil {
		t.Fatal("manifest unavailable")
	}
	m, e := deployment.Parse(raw)
	if e != nil {
		t.Fatal(e)
	}
	if m.ChainID != 421614 {
		t.Fatal("test restricted to Arbitrum Sepolia")
	}
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		t.Fatal("RPC configuration unavailable")
	}
	tag := os.Getenv("TG_TEST_OBSERVATION_BLOCK")
	if tag == "" {
		t.Fatal("explicit observation block required")
	}
	header, e := rpc.Header(ctx, tag)
	if e != nil {
		t.Fatal("archive header unavailable")
	}
	height, e := header.Height()
	if e != nil {
		t.Fatal(e)
	}
	p, e := pgxpool.New(ctx, os.Getenv("TG_LIVE_DATABASE_URL"))
	if e != nil {
		t.Fatal("live database unavailable")
	}
	defer p.Close()
	var canonical bool
	e = p.QueryRow(ctx, `SELECT canonical AND receipts_verified FROM tickergarden.chain_blocks WHERE chain_id=$1 AND hash=$2`, m.ChainID, header.Hash).Scan(&canonical)
	if e != nil || !canonical {
		t.Fatal("anchor not locally verified")
	}
	rows, e := p.Query(ctx, `SELECT m.payload FROM tickergarden.canonical_discovered_markets m JOIN tickergarden.chain_blocks b ON b.chain_id=m.chain_id AND b.hash=m.block_hash WHERE m.chain_id=$1 AND b.number<=$2`, m.ChainID, height)
	if e != nil {
		t.Fatal("discovery unavailable")
	}
	markets := map[string]deployment.MarketDiscovery{}
	for rows.Next() {
		var raw []byte
		var d deployment.MarketDiscovery
		if e = rows.Scan(&raw); e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(raw, &d); e != nil {
			t.Fatal(e)
		}
		markets[d.MarketID] = d
	}
	e = rows.Err()
	rows.Close()
	if e != nil || len(markets) < 2 {
		t.Fatal("multi-market discovery missing")
	}
	rs, e := Plan(m, header, markets, nil)
	if e != nil {
		t.Fatal(e)
	}
	// The baseline shares reads within its attempt. Scoped jobs use independent
	// cold sessions, matching the deployed worker. This is a bounded sample only.
	session := deployment.NewReadSession(rpc, header.Hash)
	fees, e := deployment.ObserveFeeBlock(ctx, session, m, header, markets)
	if e != nil {
		t.Fatal("baseline fee observation failed")
	}
	holders, e := deployment.ObserveHolderBlock(ctx, session, m, header, markets)
	if e != nil {
		t.Fatal("baseline holder observation failed")
	}
	whole := []Request{{Version: Version, Kind: "fees", Manifest: m, Block: header, Markets: markets}, {Version: Version, Kind: "holders", Manifest: m, Block: header, Markets: markets}}
	expectedFee, expectedHolder, e := Merge(whole, []deployment.ObservationBatch{fees, holders})
	if e != nil {
		t.Fatal(e)
	}
	s := Store{Pool: queueDB(t)}
	run := func(c context.Context, r Request) (deployment.ObservationBatch, error) { return Execute(c, rpc, r) }
	started := time.Now()
	actualFee, actualHolder, e := s.Resolve(ctx, rs, run)
	if e != nil {
		t.Fatal(e)
	}
	for i, pair := range [][2]deployment.ObservationBatch{{expectedFee, actualFee}, {expectedHolder, actualHolder}} {
		a, _ := json.Marshal(pair[0])
		b, _ := json.Marshal(pair[1])
		if !bytes.Equal(a, b) {
			t.Fatalf("phase %d differs", i)
		}
	}
	cachedFee, cachedHolder, e := s.Resolve(ctx, rs, func(context.Context, Request) (deployment.ObservationBatch, error) {
		t.Error("durable cache missed")
		return deployment.ObservationBatch{}, ErrPending
	})
	if e != nil {
		t.Fatal(e)
	}
	for _, pair := range [][2]deployment.ObservationBatch{{actualFee, cachedFee}, {actualHolder, cachedHolder}} {
		a, _ := json.Marshal(pair[0])
		b, _ := json.Marshal(pair[1])
		if !bytes.Equal(a, b) {
			t.Fatal("restart changed financial evidence")
		}
	}
	t.Logf("coldQueueAndRestartMillis=%d", time.Since(started).Milliseconds())
	final, e := rpc.Header(ctx, header.Number)
	if e != nil || final.Hash != header.Hash || final.Timestamp != header.Timestamp {
		t.Fatal("live final fence failed")
	}
	chain, e := rpc.ChainID(ctx)
	if e != nil || chain != m.ChainID {
		t.Fatal("chain fence failed")
	}
	t.Logf("chain=%d block=%d hash=%s markets=%d groups=%d feeRows=%d holderRows=%d equivalent=true cacheRestart=true", chain, height, header.Hash, len(markets), len(rs)/2, actualFee.Expected, actualHolder.Expected)
}
