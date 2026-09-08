package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/readmodel"
)

func TestWatchPostgresPublicationAndRecovery(t *testing.T) {
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TG_TEST_DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_watch_publish_%d", time.Now().UnixNano())
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
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	cfg, err := pgx.ParseConfig(u.String())
	if err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDB(*cfg)
	defer db.Close()
	migrations, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = migrations.Up(ctx); err != nil {
		t.Fatal(err)
	}
	sql := func(query string, args ...any) {
		t.Helper()
		if _, e := db.ExecContext(ctx, query, args...); e != nil {
			t.Fatal(e)
		}
	}
	data, err := os.ReadFile("../../internal/readmodel/testdata/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := readmodel.Parse(data, 46630)
	if err != nil {
		t.Fatal(err)
	}
	hash := *snapshot.Sync.BlockHash
	genesis := "0x" + strings.Repeat("f", 64)
	sql(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(46630,$1,1,1,$2,1,$2)`, genesis, hash)
	sql(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES(46630,1,$1,$2,true)`, hash, genesis)
	sources := []readmodel.SourceBlock{}
	for _, m := range snapshot.Markets {
		sources = append(sources, m.Source)
	}
	for _, c := range snapshot.Configs {
		sources = append(sources, c.Source)
	}
	for _, p := range snapshot.Positions {
		sources = append(sources, p.Source)
	}
	for _, s := range sources {
		raw, _ := json.Marshal(map[string]any{"transactionHash": s.TransactionHash, "transactionIndex": fmt.Sprintf("0x%x", s.TransactionIndex)})
		sql(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES(46630,$1,$2,$3,$4) ON CONFLICT DO NOTHING`, s.BlockHash, s.LogIndex, "0x"+strings.Repeat("1", 40), raw)
	}
	t.Setenv("TG_CHAIN_ID", "46630")
	t.Setenv("TG_PUBLISHER_DATABASE_URL", u.String())
	t.Setenv("TG_PUBLISH_ACCOUNTS", "false")
	t.Setenv("TG_PUBLISH_IDENTITIES", "false")
	path := filepath.Join(t.TempDir(), "producer.json")
	at := time.Now()
	writeEnvelope(t, path, at, string(data))
	successes, rejections := 0, 0
	output := watchWriter(func(b []byte) (int, error) {
		var event struct{ Status string }
		if e := json.Unmarshal(b, &event); e != nil {
			t.Fatal(e)
		}
		switch event.Status {
		case "published":
			successes++
			if successes == 1 {
				// Same immutable revision, different otherwise valid content.
				conflicting := snapshot
				conflicting.Markets = append([]readmodel.MarketReadModel(nil), snapshot.Markets...)
				conflicting.Markets[0].CurveProgress.RealQuoteReserve = "123"
				raw, e := json.Marshal(conflicting)
				if e != nil {
					t.Fatal(e)
				}
				if _, e = readmodel.Parse(raw, 46630); e != nil {
					t.Fatal("conflict fixture invalid", e)
				}
				writeEnvelope(t, path, at, string(raw))
			} else {
				cancel()
			}
		case "retry_pending":
			rejections++
			if successes != 1 || rejections != 1 {
				t.Fatal("unexpected failure order", successes, rejections)
			}
			nextHash := "0x" + strings.Repeat("c", 64)
			number := "2"
			sql(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified) VALUES(46630,2,$1,$2,true)`, nextHash, hash)
			sql(`UPDATE tickergarden.chain_journal SET tip_number=2,tip_hash=$1,finalized_number=2,finalized_hash=$1,updated_at=now() WHERE chain_id=46630`, nextHash)
			snapshot.Sync.BlockNumber = &number
			snapshot.Sync.HeadBlockNumber = &number
			snapshot.Sync.BlockHash = &nextHash
			snapshot.Sync.HeadBlockHash = &nextHash
			snapshot.Sync.Revision = number + ":" + nextHash
			raw, e := json.Marshal(snapshot)
			if e != nil {
				t.Fatal(e)
			}
			writeEnvelope(t, path, at, string(raw))
		default:
			t.Fatal("unknown status", event.Status)
		}
		return len(b), nil
	})
	err = watch(ctx, path, output, time.Millisecond, publish)
	if err != context.Canceled || successes != 2 || rejections != 1 {
		t.Fatal("watch recovery", successes, rejections, err)
	}
	// Cancellation stops the loop, so inspect durable rows using a fresh context.
	var count int
	if err = db.QueryRowContext(context.Background(), `SELECT count(*) FROM tickergarden.read_snapshots`).Scan(&count); err != nil || count != 2 {
		t.Fatal("unexpected publications", count, err)
	}
	var stored string
	if err = db.QueryRowContext(context.Background(), `SELECT convert_from(payload,'UTF8')::jsonb->'markets'->0->'curveProgress'->>'realQuoteReserve' FROM tickergarden.read_snapshots WHERE block_number=1`).Scan(&stored); err != nil || stored == "123" {
		t.Fatal("immutable snapshot overwritten", stored, err)
	}
}
