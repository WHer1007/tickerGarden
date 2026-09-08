package integration

// This is an opt-in, local PostgreSQL capacity check.  It uses the existing
// independently materialized sparse Treasury history (604801 blocks) and does not
// contact a public chain or claim public-chain coverage.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/treasury"
)

func TestSevenDayHistoryCapacity(t *testing.T) {
	if os.Getenv("TG_TEST_CAPACITY") != "1" {
		t.Skip("set TG_TEST_CAPACITY=1 to run the opt-in local PostgreSQL capacity fixture")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TG_TEST_DATABASE_URL to a local PostgreSQL server with CREATEDB permission")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid test database URL")
	}
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal("cannot connect to local PostgreSQL")
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_capacity_test_%d", time.Now().UnixNano())
	id := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+id); err != nil {
		t.Fatal("cannot create isolated capacity database")
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if _, e := admin.Exec(cleanup, "DROP DATABASE "+id+" WITH (FORCE)"); e != nil {
			t.Error("could not remove isolated capacity database")
		}
	}()
	testCfg := cfg.Copy()
	testCfg.Database = name
	db := stdlib.OpenDB(*testCfg)
	defer db.Close()
	provider, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = provider.Up(ctx); err != nil {
		t.Fatal("capacity fixture migrations failed", err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	pool, err := postgres.Open(ctx, u.String(), 2)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	started := time.Now()
	// Materialize the one-second cadence as actual contiguous block rows. This
	// is deliberately separate from the normal two-block Treasury fixture.
	const blocks = 604801
	if _, err = pool.Exec(ctx, `
		INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash)
		VALUES (4663, '0x' || repeat('a',64), 1, $1, '0x' || lpad(to_hex($1::bigint),64,'0'), $1, '0x' || lpad(to_hex($1::bigint),64,'0'))`, blocks); err != nil {
		t.Fatal("journal fixture failed", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified)
		SELECT 4663, n, '0x'||lpad(to_hex(n),64,'0'), '0x'||lpad(to_hex(n-1),64,'0'), 100+n-1, true
		FROM generate_series(1,$1::bigint) AS s(n)`, blocks); err != nil {
		t.Fatal("block fixture failed", err)
	}

	const chain = 4663
	zero := "0x" + strings.Repeat("0", 40)
	token := "0x" + strings.Repeat("1", 40)
	curve := "0x" + strings.Repeat("2", 40)
	factory := "0x" + strings.Repeat("3", 40)
	user := "0x" + strings.Repeat("4", 40)
	marketID := hash(111)
	creationHash := hash(1)
	sourceHash := hash(blocks)
	end := uint64(100) + treasury.Duration
	emptyCommitment, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{})
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipt_count=0,receipt_set_hash=$1 WHERE chain_id=4663`, emptyCommitment); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES(4663,$1,1,$2,$3)`, hash(120), blocks, sourceHash); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) SELECT chain_id,hash FROM tickergarden.chain_blocks WHERE chain_id=4663`); err != nil {
		t.Fatal(err)
	}
	addrWord := func(a string) string { return "0x" + strings.Repeat("0", 24) + a[2:] }
	mint := chainrpc.Log{Address: token, Topics: []string{deployment.Hash([]byte("Transfer(address,address,uint256)")), addrWord(zero), addrWord(curve)}, Data: fmt.Sprintf("0x%064x", 100), BlockNumber: "0x1", BlockHash: creationHash, TransactionHash: hash(130), TransactionIndex: "0x0", LogIndex: "0x0"}
	buy := mint
	buy.Topics = []string{mint.Topics[0], addrWord(curve), addrWord(user)}
	buy.LogIndex = "0x1"
	created := mint
	created.Address = factory
	created.LogIndex = "0x2"
	created.Topics = []string{deployment.Hash([]byte("MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)")), marketID, hash(0), addrWord(token)}
	created.Data = addrWord(curve) + strings.Repeat("0", 128) + strings.Repeat(hash(1)[2:], 3)
	logs := []chainrpc.Log{mint, buy, created}
	putLog := func(index int) {
		data, _ := json.Marshal(logs[index])
		if _, e := pool.Exec(ctx, `INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,$3,$4,$5)`, chain, creationHash, index, logs[index].Address, data); e != nil {
			t.Fatal(e)
		}
	}
	for i := range logs {
		putLog(i)
	}
	receipt := chainrpc.Receipt{TransactionHash: hash(130), TransactionIndex: "0x0", BlockHash: creationHash, BlockNumber: "0x1", Status: "0x1", Logs: logs}
	receiptBytes, _ := json.Marshal(receipt)
	if _, e := pool.Exec(ctx, `INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, chain, creationHash, receipt.TransactionHash, receiptBytes); e != nil {
		t.Fatal(e)
	}
	discovered := deployment.MarketDiscovery{MarketID: marketID, Source: created, State: map[string]any{"memeToken": token, "quoteAsset": zero, "curve": curve}}
	data, _ := json.Marshal(discovered)
	if _, e := pool.Exec(ctx, `INSERT INTO tickergarden.discovered_markets(chain_id,block_hash,market_id,log_index,payload) VALUES($1,$2,$3,2,$4)`, chain, creationHash, marketID, data); e != nil {
		t.Fatal(e)
	}

	commitment, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipt_count=1,receipt_set_hash=$1 WHERE chain_id=4663 AND number=1`, commitment); err != nil {
		t.Fatal(err)
	}
	excluded := []string{zero, curve}
	policy, _ := treasury.PolicyHash("4663", marketID, excluded)
	in := treasury.Input{Context: treasury.Context{ChainID: "4663", Distributor: factory, MarketID: marketID, EpochID: 1, MemeToken: token, QuoteToken: zero, EligibilityPolicyHash: policy, WindowStart: "100", WindowEnd: fmt.Sprint(end), SourceBlockNumber: fmt.Sprint(blocks), SourceBlockHash: sourceHash}, ExcludedAccounts: excluded, SourceBlockTimestamp: fmt.Sprint(end), QuoteAmount: "1000", Transfers: []treasury.Transfer{}}
	fixtureSeconds := time.Since(started).Seconds()
	runtime.GC()
	var memBefore, memAfter runtime.MemStats
	runtime.ReadMemStats(&memBefore)
	loadStart := time.Now()
	loaded, proof, err := treasury.LoadJournalInput(ctx, pool, in)
	if err != nil || proof.BlockCount != blocks || proof.TransferCount != 2 || !proof.JournalRangeChecked {
		t.Fatalf("seven-day loader failed: %+v %v", proof, err)
	}
	dataset, err := treasury.Generate(loaded)
	if err != nil || len(dataset.Leaves) != 1 || dataset.Leaves[0].Account != user || dataset.TotalAllocated != "1000" {
		t.Fatalf("seven-day dataset failed: %+v %v", dataset, err)
	}
	runtime.ReadMemStats(&memAfter)
	loadSeconds := time.Since(loadStart).Seconds()
	var dbBytes int64
	if err = pool.QueryRow(ctx, "SELECT pg_database_size(current_database())").Scan(&dbBytes); err != nil {
		t.Fatal(err)
	}
	// A newer valid source/coverage anchor reaches the real range guard; do not
	// materialize 2.4m rows just to test a deliberate early budget rejection.
	const fastBlocks = 2419201
	if _, err = pool.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified,receipt_count,receipt_set_hash) VALUES(4663,$1,$2,$3,$4,true,0,$5)`, fastBlocks, hash(fastBlocks), hash(fastBlocks-1), end, emptyCommitment); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.chain_journal SET tip_number=$1,tip_hash=$2,finalized_number=$1,finalized_hash=$2 WHERE chain_id=4663`, fastBlocks, hash(fastBlocks)); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.discovery_checkpoints SET tip_number=$1,tip_hash=$2 WHERE chain_id=4663`, fastBlocks, hash(fastBlocks)); err != nil {
		t.Fatal(err)
	}
	over := in
	over.SourceBlockNumber = fmt.Sprint(fastBlocks)
	over.SourceBlockHash = hash(fastBlocks)
	_, _, err = treasury.LoadJournalInput(ctx, pool, over)
	if err == nil || err.Error() != "Treasury history range exceeds budget or predates creation" {
		t.Fatalf("fast-L2 real loader must reject range before scanning: %v", err)
	}
	// Histories start at token creation, so even one-second cadence exceeds the
	// same bound in the second seven-day epoch. Exercise that real guard too.
	fastErr := err.Error()
	const secondEpochSource = 1209601
	if _, err = pool.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified,receipt_count,receipt_set_hash) VALUES(4663,$1,$2,$3,$4,true,0,$5)`, secondEpochSource, hash(secondEpochSource), hash(secondEpochSource-1), end+treasury.Duration, emptyCommitment); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.chain_journal SET tip_number=$1,tip_hash=$2,finalized_number=$1,finalized_hash=$2 WHERE chain_id=4663`, secondEpochSource, hash(secondEpochSource)); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.discovery_checkpoints SET tip_number=$1,tip_hash=$2 WHERE chain_id=4663`, secondEpochSource, hash(secondEpochSource)); err != nil {
		t.Fatal(err)
	}
	over = in
	over.EpochID = 2
	over.WindowStart = fmt.Sprint(end)
	over.WindowEnd = fmt.Sprint(end + treasury.Duration)
	over.SourceBlockTimestamp = over.WindowEnd
	over.SourceBlockNumber = fmt.Sprint(secondEpochSource)
	over.SourceBlockHash = hash(secondEpochSource)
	_, _, err = treasury.LoadJournalInput(ctx, pool, over)
	if err == nil || err.Error() != fastErr {
		t.Fatalf("second-week creation-to-source history must reject: %v", err)
	}
	report := map[string]any{"status": "VALIDATION_COMPLETED_CAPACITY_LIMIT_FOUND", "synthetic": true, "scope": "Seven-day one-second-cadence sparse history, 604801 physical blocks and discovery markers, one issuance receipt and two Transfers. Not busy-chain throughput certification.", "blockRows": blocks, "fixtureBuildSeconds": fixtureSeconds, "loadAndGenerateSeconds": loadSeconds, "databaseBytes": dbBytes, "allocatedBytesDuringLoad": memAfter.TotalAlloc - memBefore.TotalAlloc, "heapAfterBytes": memAfter.HeapAlloc, "merkleRoot": dataset.MerkleRoot, "allocated": "1000", "oneSecondSparseHistory": "PASS", "quarterSecondSevenDayHistory": "UNSUPPORTED_RANGE_REJECTED", "oneSecondSecondEpochHistory": "UNSUPPORTED_RANGE_REJECTED", "overLimitLoaderError": err.Error(), "overLimitFixture": "Only source/coverage anchor materialized for early range rejection; not a full 2.4m-row scan"}
	if out := os.Getenv("TG_TEST_EVIDENCE_DIR"); out != "" {
		b, _ := json.MarshalIndent(report, "", "  ")
		if err = os.WriteFile(filepath.Join(out, "seven-day-capacity.json"), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("604801-block seven-day LoadJournalInput + Generate PASS: build=%.2fs load=%.2fs DB=%d bytes; fast-L2 real range guard rejects", fixtureSeconds, loadSeconds, dbBytes)
}
