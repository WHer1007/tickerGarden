package projector

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/migration"
	"time"
)

func TestHistoricalServiceAssetsPostgres(t *testing.T) {
	if os.Getenv("TG_TEST_CREATOR_CANDIDATE") != "1" {
		t.Skip("set TG_TEST_CREATOR_CANDIDATE=1")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
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
	name := fmt.Sprintf("tg_service_assets_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, err := admin.Exec(cleanup, "DROP DATABASE "+quoted+" WITH (FORCE)"); err != nil {
			t.Error(err)
		}
	}()
	cfg = cfg.Copy()
	cfg.Database = name
	db := stdlib.OpenDB(*cfg)
	defer db.Close()
	m, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Up(ctx); err != nil {
		t.Fatal(err)
	}
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	hash := "0x" + strings.Repeat("1", 64)
	d := "0x" + strings.Repeat("2", 40)
	asset := "0x" + strings.Repeat("3", 40)
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(46630,$1,1,1,$1,1,$1)`, hash)
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES(46630,1,$1,$1,100,true)`, hash)
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES(46630,$1,1,1,$1)`, hash)
	exec(`INSERT INTO tickergarden.projection_checkpoints(chain_id,manifest_hash,projector_version,start_block,tip_number,tip_hash) VALUES(46630,$1,$2,1,1,$1)`, hash, Version)
	signature := "RootRequested(bytes32,uint32,address,uint64,uint64,uint64,bytes32,uint256,address,uint128,uint64)"
	row := map[string]any{"provenance": map[string]any{"emitter": d}, "signature": signature, "args": map[string]any{"serviceFeeAsset": asset}}
	payload, _ := json.Marshal(row)
	for _, key := range []string{"request1", "request2"} {
		exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(46630,'events',$1,$2,$3)`, key, payload, hash)
	}
	// Epoch cancellation changes its state, but does not remove the request fact.
	exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(46630,'observations','reset','{}',$1)`, hash)
	got, err := historicalServiceAssets(ctx, tx, 46630)
	if err != nil || len(got) != 1 || got[0].Distributor != d || got[0].Asset != asset {
		t.Fatal(got, err)
	}
	exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE hash=$1`, hash)
	got, err = historicalServiceAssets(ctx, tx, 46630)
	if err != nil || len(got) != 0 {
		t.Fatal("orphan asset retained", got, err)
	}
	exec(`UPDATE tickergarden.chain_blocks SET canonical=true,receipts_verified=false WHERE hash=$1`, hash)
	got, err = historicalServiceAssets(ctx, tx, 46630)
	if err != nil || len(got) != 0 {
		t.Fatal("unverified asset retained", got, err)
	}
}
