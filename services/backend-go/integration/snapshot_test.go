package integration

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/readmodel"
)

func testReadSnapshots(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	data, e := os.ReadFile("../internal/readmodel/testdata/snapshot.json")
	if e != nil {
		t.Fatal(e)
	}
	store := readmodel.Store{Pool: pool, ChainID: 46630}
	snapshot, e := readmodel.Parse(data, 46630)
	if e != nil {
		t.Fatal(e)
	}
	encode := func(s readmodel.Snapshot) []byte {
		t.Helper()
		b, e := json.Marshal(s)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	publish := func(s readmodel.Snapshot) {
		t.Helper()
		if e := store.Publish(ctx, encode(s), time.Now()); e != nil {
			t.Fatal(e)
		}
	}
	handler := httpapi.New(httpapi.Options{Database: pool, ReadModels: &store, ChainID: 46630})
	checkUpdates := func(since string, code int, mode, revision string) {
		t.Helper()
		path := "/v1/updates"
		if since != "" {
			path += "?since=" + url.QueryEscape(since)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != code {
			t.Fatalf("updates %s: %d %s", since, response.Code, response.Body.String())
		}
		schema := "SnapshotUpdatesError"
		if code == 200 {
			schema = "SnapshotUpdatesResponse"
		}
		if err := readmodel.ValidateResponse(schema, response.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		expectation, err := json.Marshal(map[string]any{"since": since, "code": code, "mode": mode, "revision": revision})
		if err != nil {
			t.Fatal(err)
		}
		testFrontendAnalyticsHTTP(t, handler, "updates", string(expectation))
		if code == 200 {
			var result struct {
				Mode        string
				Sync        readmodel.SyncStatus
				Invalidated []string
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Mode != mode || result.Sync.Revision != revision || result.Sync.Status != "synced" || result.Sync.Finality != "finalized" {
				t.Fatalf("invalid persisted update: %+v", result)
			}
			if mode == "reset" && len(result.Invalidated) != 4 {
				t.Fatal("reset omitted caches")
			}
			if mode == "unchanged" && len(result.Invalidated) != 0 {
				t.Fatal("unchanged invalidated caches")
			}
		}
	}
	publish(snapshot)
	publish(snapshot)
	checkUpdates("", 200, "reset", snapshot.Sync.Revision)
	checkUpdates(snapshot.Sync.Revision, 200, "unchanged", snapshot.Sync.Revision)
	var count int
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.read_snapshots").Scan(&count); e != nil || count != 1 {
		t.Fatal("duplicate publication", count, e)
	}
	current, e := store.Load(ctx, "")
	if e != nil || current.Sync.Status != "synced" {
		t.Fatal("snapshot not readable", e)
	}
	snapshot.Markets[0].CurveProgress.RealQuoteReserve = "123"
	if e = store.Publish(ctx, encode(snapshot), time.Now()); e == nil {
		t.Fatal("immutable revision changed")
	}
	snapshot.Markets[0].CurveProgress.RealQuoteReserve = "900719925474099312345"
	oldRevision := snapshot.Sync.Revision
	two, h2 := "2", hash(22)
	snapshot.Sync.BlockNumber = &two
	snapshot.Sync.BlockHash = &h2
	snapshot.Sync.HeadBlockNumber = &two
	snapshot.Sync.HeadBlockHash = &h2
	snapshot.Sync.Revision = two + ":" + h2
	snapshot.Markets[0].Source.TransactionHash = hash(500)
	if e = store.Publish(ctx, encode(snapshot), time.Now()); e == nil {
		t.Fatal("accepted unknown provenance")
	}
	snapshot.Markets[0].Source.TransactionHash = hash(99)
	badHash := hash(400)
	snapshot.Sync.BlockHash = &badHash
	snapshot.Sync.Revision = two + ":" + badHash
	if e = store.Publish(ctx, encode(snapshot), time.Now()); e == nil {
		t.Fatal("accepted noncanonical snapshot")
	}
	snapshot.Sync.BlockHash = &h2
	snapshot.Sync.Revision = two + ":" + h2
	if e = store.Publish(ctx, encode(snapshot), time.Now().Add(-3*time.Minute)); e == nil {
		t.Fatal("accepted stale verification")
	}
	publish(snapshot)
	checkUpdates(oldRevision, 200, "changed", snapshot.Sync.Revision)
	pinned, e := store.Load(ctx, oldRevision)
	if e != nil || pinned.Sync.Revision != oldRevision {
		t.Fatal("cannot pin retained revision", e)
	}
	response := httptest.NewRecorder()
	httpapi.New(httpapi.Options{Database: pool, ReadModels: &store, ChainID: 46630}).ServeHTTP(response, httptest.NewRequest("GET", "/readyz", nil))
	if response.Code != 200 {
		t.Fatal("verified read API not ready", response.Body.String())
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipts_verified=false WHERE chain_id=46630 AND number=1`); e != nil {
		t.Fatal(e)
	}
	current, e = store.Load(ctx, "")
	if e != nil || current.Sync.Status != "unavailable" {
		t.Fatal("missing receipt coverage advertised synced", e)
	}
	checkUpdates(snapshot.Sync.Revision, 503, "", "")
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipts_verified=true WHERE chain_id=46630 AND number=1`); e != nil {
		t.Fatal(e)
	}
	checkUpdates(snapshot.Sync.Revision, 200, "unchanged", snapshot.Sync.Revision)
	// Staleness of either producer or indexer disables writes/claims in clients;
	// a duplicate publish must not renew the producer timestamp.
	if _, e = pool.Exec(ctx, "UPDATE tickergarden.read_snapshots SET verified_at=now()-interval '3 minutes'"); e != nil {
		t.Fatal(e)
	}
	publish(snapshot)
	current, e = store.Load(ctx, "")
	if e != nil || current.Sync.Status != "unavailable" {
		t.Fatal("stale snapshot advertised synced", e)
	}
	checkUpdates(oldRevision, 503, "", "")
	if _, e = store.Load(ctx, oldRevision); !errors.Is(e, readmodel.ErrRevision) {
		t.Fatal("stale current state allowed revision pinning", e)
	}
	if _, e = pool.Exec(ctx, "UPDATE tickergarden.read_snapshots SET verified_at=now()"); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, "UPDATE tickergarden.chain_journal SET updated_at=now()-interval '3 minutes'"); e != nil {
		t.Fatal(e)
	}
	current, e = store.Load(ctx, "")
	if e != nil || current.Sync.Status != "unavailable" {
		t.Fatal("stale indexer advertised synced", e)
	}
	checkUpdates(snapshot.Sync.Revision, 503, "", "")
	if _, e = pool.Exec(ctx, "UPDATE tickergarden.chain_journal SET updated_at=now()"); e != nil {
		t.Fatal(e)
	}
	checkUpdates(snapshot.Sync.Revision, 200, "unchanged", snapshot.Sync.Revision)
	// Exercise the 32-version read window with explicit test chain observations.
	for n := 3; n <= 34; n++ {
		num := strconv.Itoa(n)
		h := hash(1000 + n)
		if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=46630 AND number=$1`, n); e != nil {
			t.Fatal(e)
		}
		if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES(46630,$1,$2,$3,true)`, n, h, hash(999+n)); e != nil {
			t.Fatal(e)
		}
		if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_journal SET tip_number=$1,tip_hash=$2,finalized_number=$1,finalized_hash=$2,updated_at=now() WHERE chain_id=46630`, n, h); e != nil {
			t.Fatal(e)
		}
		snapshot.Sync.BlockNumber = &num
		snapshot.Sync.HeadBlockNumber = &num
		snapshot.Sync.BlockHash = &h
		snapshot.Sync.HeadBlockHash = &h
		snapshot.Sync.Revision = num + ":" + h
		publish(snapshot)
	}
	if _, e = store.Load(ctx, oldRevision); !errors.Is(e, readmodel.ErrRevision) {
		t.Fatal("expired revision still exposed", e)
	}
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.read_snapshots").Scan(&count); e != nil || count != 34 {
		t.Fatal("immutable audit history discarded", count, e)
	}
	checkUpdates(oldRevision, 200, "reset", snapshot.Sync.Revision)
	// Lost canonical provenance invalidates even a recently verified publication.
	if _, e = pool.Exec(ctx, "UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=46630 AND number=34"); e != nil {
		t.Fatal(e)
	}
	current, e = store.Load(ctx, "")
	if e != nil || current.Sync.Status != "unavailable" {
		t.Fatal("orphan snapshot advertised synced", e)
	}
	checkUpdates(snapshot.Sync.Revision, 503, "", "")
	orphanRevision := snapshot.Sync.Revision
	// Controlled journal reorg followed by a new, strictly advancing publication.
	// This exercises publication/read/SDK recovery, not RPC reorg discovery.
	replacementHash, nextHash := hash(2034), hash(2035)
	if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES(46630,34,$1,$2,true),(46630,35,$3,$1,true)`, replacementHash, hash(1033), nextHash); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_journal SET tip_number=35,tip_hash=$1,finalized_number=35,finalized_hash=$1,updated_at=now() WHERE chain_id=46630`, nextHash); e != nil {
		t.Fatal(e)
	}
	// A canonical replacement alone does not repair the orphan publication.
	checkUpdates(orphanRevision, 503, "", "")
	nextNumber := "35"
	snapshot.Sync.BlockNumber = &nextNumber
	snapshot.Sync.HeadBlockNumber = &nextNumber
	snapshot.Sync.BlockHash = &nextHash
	snapshot.Sync.HeadBlockHash = &nextHash
	snapshot.Sync.Revision = nextNumber + ":" + nextHash
	publish(snapshot)
	checkUpdates(orphanRevision, 200, "reset", snapshot.Sync.Revision)
	checkUpdates(snapshot.Sync.Revision, 200, "unchanged", snapshot.Sync.Revision)
	if _, e = store.Load(ctx, orphanRevision); !errors.Is(e, readmodel.ErrRevision) {
		t.Fatal("orphan revision remained pinnable", e)
	}
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.read_snapshots").Scan(&count); e != nil || count != 35 {
		t.Fatal("recovery discarded audit history", count, e)
	}
	// Add account coverage to a new immutable producer snapshot.
	p := snapshot.Positions[0]
	vault := "0x" + strings.Repeat("9", 40)
	for i := range snapshot.Configs {
		if snapshot.Configs[i].Kind == "asset" && snapshot.Configs[i].ID == p.AssetUID {
			snapshot.Configs[i].Values["userStockVault"] = vault
		}
	}
	free, _ := new(big.Int).SetString(p.Free, 10)
	allocated, _ := new(big.Int).SetString(p.Allocated, 10)
	idleUser := "0x" + strings.Repeat("8", 40)
	accounts := []readmodel.UserAccountReadModel{{User: p.User, AssetUID: p.AssetUID, Vault: vault, Deposited: new(big.Int).Add(free, allocated).String(), Allocated: p.Allocated, Free: p.Free, Source: p.Source}, {User: idleUser, AssetUID: p.AssetUID, Vault: vault, Deposited: "9", Allocated: "0", Free: "9", Source: p.Source}}
	snapshot.Accounts = &accounts
	h36, n36 := hash(2036), "36"
	if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES(46630,36,$1,$2,true)`, h36, nextHash); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_journal SET tip_number=36,tip_hash=$1,finalized_number=36,finalized_hash=$1,updated_at=now() WHERE chain_id=46630`, h36); e != nil {
		t.Fatal(e)
	}
	snapshot.Sync.BlockNumber = &n36
	snapshot.Sync.HeadBlockNumber = &n36
	snapshot.Sync.BlockHash = &h36
	snapshot.Sync.HeadBlockHash = &h36
	snapshot.Sync.Revision = n36 + ":" + h36
	accounts[1].Source.TransactionHash = hash(999)
	if e = store.Publish(ctx, encode(snapshot), time.Now()); e == nil {
		t.Fatal("unproven account source published")
	}
	accounts[1].Source = p.Source
	publish(snapshot)
	accountExpectation, e := json.Marshal(map[string]any{"sync": snapshot.Sync, "assets": snapshot.Configs, "wallets": []map[string]any{
		{"wallet": p.User, "items": []readmodel.UserAccountReadModel{accounts[0]}},
		{"wallet": idleUser, "items": []readmodel.UserAccountReadModel{accounts[1]}},
		{"wallet": "0x" + strings.Repeat("7", 40), "items": []readmodel.UserAccountReadModel{}},
	}})
	if e != nil {
		t.Fatal(e)
	}
	testFrontendAnalyticsHTTP(t, handler, "accounts", string(accountExpectation))

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/v1/users/"+idleUser+"/accounts", nil))
	if response.Code != 200 || readmodel.ValidateResponse("AccountPage", response.Body.Bytes()) != nil {
		t.Fatal("account PostgreSQL HTTP", response.Code, response.Body.String())
	}
	var accountPage struct {
		Items []readmodel.UserAccountReadModel
	}
	if json.Unmarshal(response.Body.Bytes(), &accountPage) != nil || len(accountPage.Items) != 1 || accountPage.Items[0].Free != "9" || accountPage.Items[0].Allocated != "0" {
		t.Fatal("no-position principal omitted", response.Body.String())
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_journal SET updated_at=now()-interval '1 hour' WHERE chain_id=46630`); e != nil {
		t.Fatal(e)
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/v1/users/"+idleUser+"/accounts", nil))
	if response.Code != 503 {
		t.Fatal("stale account principal served")
	}
	testFrontendAnalyticsHTTP(t, handler, "accounts-unavailable", string(accountExpectation))
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_journal SET updated_at=now() WHERE chain_id=46630`); e != nil {
		t.Fatal(e)
	}
}
