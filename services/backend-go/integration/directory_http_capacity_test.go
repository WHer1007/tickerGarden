package integration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/readmodel"
)

// Opt-in because this measures the actual database + HTTP path, including schema
// parsing, publication provenance checks and complete identity verification.
func TestDirectoryHTTPCapacity(t *testing.T) {
	if os.Getenv("TG_TEST_DIRECTORY_HTTP") != "1" {
		t.Skip("set TG_TEST_DIRECTORY_HTTP=1 for isolated directory capacity")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL required")
	}
	size := 1000
	if raw := os.Getenv("TG_TEST_DIRECTORY_MARKETS"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || strconv.Itoa(value) != raw || value < 200 || value > 8000 {
			t.Fatal("TG_TEST_DIRECTORY_MARKETS must be a canonical integer from 200 to 8000")
		}
		size = value
	}
	rounds := 1
	if raw := os.Getenv("TG_TEST_DIRECTORY_ROUNDS"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || strconv.Itoa(value) != raw || value < 1 || value > 10 {
			t.Fatal("TG_TEST_DIRECTORY_ROUNDS must be a canonical integer from 1 to 10")
		}
		rounds = value
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid database URL")
	}
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal("database unavailable")
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_directory_test_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, e := admin.Exec(cleanup, "DROP DATABASE "+quoted+" WITH (FORCE)"); e != nil {
			t.Error(e)
		}
	}()
	dbCfg := cfg.Copy()
	dbCfg.Database = name
	db := stdlib.OpenDB(*dbCfg)
	defer db.Close()
	migrations, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = migrations.Up(ctx); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	pool, err := postgres.Open(ctx, u.String(), 4)
	if err != nil {
		t.Fatal(err)
	}
	var trace *directoryQueryTrace
	if os.Getenv("TG_TEST_DIRECTORY_TRACE") == "1" {
		config := pool.Config()
		pool.Close()
		trace = &directoryQueryTrace{}
		config.ConnConfig.Tracer = trace
		pool, err = pgxpool.NewWithConfig(ctx, config)
		if err != nil {
			t.Fatal(err)
		}
	}
	defer pool.Close()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	const chain = uint64(46630)
	block, txHash, manifest := hash(11), hash(99), hash(999)
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,1,1,$3,1,$3)`, chain, hash(800), block)
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES($1,1,$2,$3,100,true)`, chain, block, hash(800))
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES($1,$2,1,1,$3)`, chain, manifest, block)
	exec(`INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES($1,$2)`, chain, block)
	raw, err := os.ReadFile("../internal/readmodel/testdata/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := readmodel.Parse(raw, chain)
	if err != nil {
		t.Fatal(err)
	}
	base := snapshot.Markets[0]
	snapshot.Markets = nil
	snapshot.Configs = []readmodel.ConfigReadModel{}
	snapshot.Positions = []readmodel.UserPositionReadModel{}
	logs, discoveries, identities := [][]any{}, [][]any{}, [][]any{}
	receipt := chainrpc.Receipt{BlockHash: block, BlockNumber: "0x1", TransactionHash: txHash, TransactionIndex: "0x0", Status: "0x1", Logs: []chainrpc.Log{}}
	for i := range size {
		id := hash(10000 + i)
		token := fmt.Sprintf("0x%040x", 20000+i)
		log := chainrpc.Log{Address: fmt.Sprintf("0x%040x", 500), BlockHash: block, BlockNumber: "0x1", TransactionHash: txHash, TransactionIndex: "0x0", LogIndex: fmt.Sprintf("0x%x", i), Topics: []string{}, Data: "0x"}
		receipt.Logs = append(receipt.Logs, log)
		logRaw, _ := json.Marshal(log)
		discovered := deployment.MarketDiscovery{MarketID: id, Source: log, State: map[string]any{"memeToken": token}}
		discoveredRaw, _ := json.Marshal(discovered)
		identity := deployment.MarketIdentity{ChainID: chain, MarketID: id, MemeToken: token, BlockHash: block, BlockNumber: "0x1", DeployedAt: "100", RuntimeCodeHash: hash(600), Name: fmt.Sprintf("Market %04d", i), Symbol: fmt.Sprintf("TG%04d", i)}
		identityRaw, _ := json.Marshal(identity)
		digest := sha256.Sum256(identityRaw)
		logs = append(logs, []any{chain, block, i, log.Address, logRaw})
		discoveries = append(discoveries, []any{chain, block, id, i, discoveredRaw})
		identities = append(identities, []any{chain, block, id, manifest, identityRaw, hex.EncodeToString(digest[:])})
		market := base
		market.MarketID = id
		market.MemeToken = token
		market.LaunchPhase = uint64(i % 2)
		market.CanonicalRoute.LaunchPhase = market.LaunchPhase
		if market.LaunchPhase == 1 {
			poolID := hash(50000 + i)
			market.PoolID = &poolID
			market.PoolKey = &readmodel.PoolKeyReadModel{Currency0: market.QuoteAsset, Currency1: token, Fee: 3000, TickSpacing: 60, Hooks: market.CanonicalRoute.Hook}
			market.CanonicalRoute.CurveTradingEnabled = false
			market.CanonicalRoute.PoolTradingEnabled = true
		}
		market.Source.LogIndex = uint64(i)
		snapshot.Markets = append(snapshot.Markets, market)
	}
	for _, copy := range []struct {
		table   string
		columns []string
		rows    [][]any
	}{
		{"chain_logs", []string{"chain_id", "block_hash", "log_index", "address", "payload"}, logs},
		{"discovered_markets", []string{"chain_id", "block_hash", "market_id", "log_index", "payload"}, discoveries},
		{"market_identities", []string{"chain_id", "block_hash", "market_id", "manifest_hash", "payload", "digest"}, identities},
	} {
		if _, err = pool.CopyFrom(ctx, pgx.Identifier{"tickergarden", copy.table}, copy.columns, pgx.CopyFromRows(copy.rows)); err != nil {
			t.Fatal(err)
		}
	}
	receiptRaw, _ := json.Marshal(receipt)
	commitment, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
	if err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, chain, block, txHash, receiptRaw)
	exec(`UPDATE tickergarden.chain_blocks SET receipt_count=1,receipt_set_hash=$1 WHERE chain_id=$2 AND hash=$3`, commitment, chain, block)
	raw, _ = json.Marshal(snapshot)
	store := &readmodel.Store{Pool: pool, ChainID: chain}
	started := time.Now()
	enriched, err := store.EnrichIdentities(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Publish(ctx, enriched, time.Now()); err != nil {
		t.Fatal(err)
	}
	t.Logf("directory snapshot markets=%d bytes=%d enrich+publish=%s", size, len(enriched), time.Since(started))
	server := httptest.NewServer(httpapi.New(httpapi.Options{ChainID: chain, ReadModels: store, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}))
	defer server.Close()
	client := &http.Client{Timeout: 10 * time.Second}
	type page struct {
		Items      []readmodel.MarketReadModel `json:"items"`
		NextCursor *string                     `json:"nextCursor"`
		Sync       readmodel.SyncStatus        `json:"sync"`
	}
	request := func(query url.Values) (page, int, time.Duration, error) {
		start := time.Now()
		response, e := client.Get(server.URL + "/v1/markets?" + query.Encode())
		if e != nil {
			return page{}, 0, 0, e
		}
		defer response.Body.Close()
		var result page
		e = json.NewDecoder(response.Body).Decode(&result)
		if response.Header.Get("Cache-Control") != "no-store" {
			return result, response.StatusCode, 0, fmt.Errorf("missing no-store")
		}
		return result, response.StatusCode, time.Since(start), e
	}
	if trace != nil {
		trace.start()
	}
	query := url.Values{"sort": {"name_asc"}, "limit": {"100"}, "revision": {snapshot.Sync.Revision}}
	seen := map[string]bool{}
	durations := []time.Duration{}
	for {
		p, status, duration, e := request(query)
		if e != nil || status != 200 || p.Sync.Status != "synced" {
			t.Fatalf("page status=%d sync=%s err=%v", status, p.Sync.Status, e)
		}
		durations = append(durations, duration)
		for _, market := range p.Items {
			expected := fmt.Sprintf("Market %04d", len(seen))
			if seen[market.MarketID] || market.Identity == nil || market.Identity.Name != expected {
				t.Fatalf("page ordering/identity differs at %d", len(seen))
			}
			seen[market.MarketID] = true
		}
		if p.NextCursor == nil {
			break
		}
		if len(seen) >= size {
			t.Fatal("pagination did not finish")
		}
		query.Set("cursor", *p.NextCursor)
	}
	if len(seen) != size {
		t.Fatal("directory truncated", len(seen))
	}
	p, status, _, err := request(url.Values{"search": {fmt.Sprintf("mArKeT %04d", size-1)}})
	if err != nil || status != 200 || len(p.Items) != 1 || p.Items[0].MarketID != hash(10000+size-1) {
		t.Fatal("full-directory search failed", status, err)
	}
	var wg sync.WaitGroup
	failures := make(chan error, 8)
	concurrentTimes := make(chan time.Duration, 8*rounds)
	startReads := make(chan struct{})
	last := size - 1
	if last%2 == 0 {
		last--
	}
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-startReads
			for round := range rounds {
				p, status, elapsed, e := request(url.Values{"launchPhase": {"1"}, "limit": {"100"}, "sort": {"marketId_desc"}, "revision": {snapshot.Sync.Revision}})
				if e != nil || status != 200 || len(p.Items) != 100 || p.Sync.Status != "synced" || p.Sync.Revision != snapshot.Sync.Revision {
					failures <- fmt.Errorf("concurrent round=%d status=%d length=%d sync=%s err=%v", round, status, len(p.Items), p.Sync.Status, e)
					return
				}
				for i, m := range p.Items {
					if m.LaunchPhase != 1 || m.MarketID != hash(10000+last-2*i) || m.Identity == nil {
						failures <- fmt.Errorf("concurrent round=%d item=%d identity/order/filter mismatch", round, i)
						return
					}
				}
				concurrentTimes <- elapsed
			}
		}()
	}
	concurrentStarted := time.Now()
	close(startReads)
	wg.Wait()
	concurrentElapsed := time.Since(concurrentStarted)
	close(failures)
	close(concurrentTimes)
	for e := range failures {
		t.Error(e)
	}
	concurrentDurations := []time.Duration{}
	for elapsed := range concurrentTimes {
		concurrentDurations = append(concurrentDurations, elapsed)
	}
	if len(concurrentDurations) != 8*rounds {
		t.Fatalf("only %d/%d concurrent reads passed", len(concurrentDurations), 8*rounds)
	}
	sort.Slice(concurrentDurations, func(i, j int) bool { return concurrentDurations[i] < concurrentDurations[j] })
	t.Logf("directory concurrency=8 rounds=%d requests=%d duration=%s throughput=%.2f/s median=%s p95=%s max=%s", rounds, len(concurrentDurations), concurrentElapsed, float64(len(concurrentDurations))/concurrentElapsed.Seconds(), concurrentDurations[len(concurrentDurations)/2], concurrentDurations[(len(concurrentDurations)*95+99)/100-1], concurrentDurations[len(concurrentDurations)-1])
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	t.Logf("HTTP markets=%d pages=%d median=%s p95=%s max=%s; concurrent results reported separately", size, len(durations), durations[len(durations)/2], durations[(len(durations)-1)*95/100], durations[len(durations)-1])
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=$2`, hash(998), chain)
	_, status, _, err = request(url.Values{"revision": {snapshot.Sync.Revision}})
	if err != nil || status != 400 {
		t.Fatal("invalidated revision accepted", status, err)
	}
	p, status, _, err = request(url.Values{})
	if err != nil || status != 200 || p.Sync.Status != "unavailable" {
		t.Fatal("invalidated source advertised healthy", status, p.Sync.Status, err)
	}
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=$2`, manifest, chain)
	p, status, _, err = request(url.Values{"search": {fmt.Sprintf("TG%04d", size-1)}})
	if err != nil || status != 200 || p.Sync.Status != "synced" || len(p.Items) != 1 {
		t.Fatal("same revision recovery failed", status, err)
	}
	if trace != nil {
		trace.report(t, ctx, pool)
	}
}
