package integration

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/postgres"
)

func TestPostgresMigrationAndReadiness(t *testing.T) {
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TG_TEST_DATABASE_URL to a local test server with CREATEDB permission")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid test database URL")
	}
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal("cannot connect to test PostgreSQL")
	}
	defer admin.Close(context.Background())
	// Never migrate the database in the supplied URL. Isolate the fixture in a
	// uniquely named database and remove only that database after closing clients.
	name := fmt.Sprintf("tg_scaffold_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		t.Fatal("cannot create isolated test database (CREATEDB required)")
	}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanupCtx, "DROP DATABASE "+identifier+" WITH (FORCE)"); err != nil {
			t.Error("could not remove isolated test database")
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
	results, err := provider.UpTo(ctx, 57)
	if err != nil || len(results) != 57 {
		t.Fatalf("pre-role migration setup: %d %v", len(results), err)
	}
	legacyGenesis := "0x" + strings.Repeat("f", 64)
	legacySender := "0x" + strings.Repeat("e", 40)
	if _, err = db.ExecContext(ctx, "INSERT INTO tickergarden.maintenance_nonce_accounts(chain_id,genesis_hash,sender,next_nonce) VALUES(46630,$1,$2,7)", legacyGenesis, legacySender); err != nil {
		t.Fatal(err)
	}
	upgraded, err := provider.Up(ctx)
	if err != nil || len(upgraded) != 3 {
		t.Fatalf("account-role upgrade: %d %v", len(upgraded), err)
	}
	results = append(results, upgraded...)
	var role string
	var next int64
	if err = db.QueryRowContext(ctx, "SELECT r.role,a.next_nonce FROM tickergarden.transaction_account_roles r JOIN tickergarden.maintenance_nonce_accounts a USING(chain_id,genesis_hash,sender) WHERE r.chain_id=46630 AND r.genesis_hash=$1 AND r.sender=$2", legacyGenesis, legacySender).Scan(&role, &next); err != nil || role != "maintenance" || next != 7 {
		t.Fatalf("legacy nonce account not preserved: %s %d %v", role, next, err)
	}
	if len(results) != 60 {
		t.Fatalf("expected fifty-nine migrations, got %d", len(results))
	}
	results, err = provider.Up(ctx)
	if err != nil || len(results) != 0 {
		t.Fatal("migration is not idempotent")
	}
	var exists bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tickergarden')").Scan(&exists); err != nil || !exists {
		t.Fatal("namespace migration missing")
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO tickergarden.chain_journal(chain_id, genesis_hash, start_block) VALUES (421614, '0xarbsepolia', 0)"); err != nil {
		t.Fatalf("Arbitrum Sepolia chain id should be accepted: %v", err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO tickergarden.chain_journal(chain_id, genesis_hash, start_block) VALUES (1, '0xunsupported', 0)"); err == nil {
		t.Fatal("unsupported chain id 1 should be rejected")
	}
	if _, err := provider.Status(ctx); err != nil {
		t.Fatal(err)
	}
	// A fresh process must find the same migration history after namespace
	// creation, even when the login role itself is named tickergarden.
	reopened := stdlib.OpenDB(*testCfg)
	defer reopened.Close()
	fresh, err := migration.New(reopened)
	if err != nil {
		t.Fatal(err)
	}
	if results, err := fresh.Up(ctx); err != nil || len(results) != 0 {
		t.Fatalf("fresh provider attempted to reapply migration: count=%d err=%v", len(results), err)
	}
	testURL, err := url.Parse(dsn)
	if err != nil || testURL.Host == "" {
		t.Fatal("test DSN must be a PostgreSQL URL")
	}
	testURL.Path = "/" + name
	pool, err := postgres.Open(ctx, testURL.String(), 2)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Fatal("pool ping failed")
	}
	testJournal(t, ctx, pool)
	testReadSnapshots(t, ctx, pool)
	testTreasuryHistory(t, ctx, pool)
	testContent(t, ctx, pool)
	testContentImport(t, ctx, pool)
	testMarketIdentity(t, ctx, pool)
	response := httptest.NewRecorder()
	httpapi.New(httpapi.Options{Database: pool, ChainID: 46630}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != 503 || !strings.Contains(response.Body.String(), `"database":"reachable"`) {
		t.Fatalf("incorrect readiness: %d %s", response.Code, response.Body)
	}
}
