package lanestatus

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"os"
	"testing"
	"tickergarden/backend/internal/migration"
	"time"
)

func laneDB(t *testing.T) *pgx.Conn {
	t.Helper()
	if os.Getenv("TG_TEST_LANE_STATUS") != "1" {
		t.Skip("set TG_TEST_LANE_STATUS=1")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	cfg, e := pgx.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	admin, e := pgx.ConnectConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { admin.Close(ctx) })
	name := fmt.Sprintf("tg_lane_%d", time.Now().UnixNano())
	q := pgx.Identifier{name}.Sanitize()
	if _, e = admin.Exec(ctx, "CREATE DATABASE "+q); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { admin.Exec(ctx, "DROP DATABASE "+q+" WITH (FORCE)") })
	cfg = cfg.Copy()
	cfg.Database = name
	db := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { db.Close() })
	m, e := migration.New(db)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = m.Up(ctx); e != nil {
		t.Fatal(e)
	}
	c, e := pgx.ConnectConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { c.Close(ctx) })
	return c
}
func TestStatusPostgresValidAndGap(t *testing.T) {
	c := laneDB(t)
	ctx := context.Background()
	hash := func(n int) string { return fmt.Sprintf("0x%064x", n) }
	manifest := hash(99)
	receipt := "sha256:" + fmt.Sprintf("%064d", 1)
	for _, q := range []string{
		`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(421614,$1,10,12,$2,12,$2)`,
	} {
		if _, e := c.Exec(ctx, q, hash(1), hash(12)); e != nil {
			t.Fatal(e)
		}
	}
	for n := 10; n <= 12; n++ {
		if _, e := c.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified,receipt_set_hash,receipt_count) VALUES(421614,$1,$2,$3,$4,true,$5,0)`, n, hash(n), hash(n-1), 100+n, receipt); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := c.Exec(ctx, `INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES(421614,$1,10,12,$2)`, manifest, hash(12)); e != nil {
		t.Fatal(e)
	}
	for n := 10; n <= 12; n++ {
		if _, e := c.Exec(ctx, `INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES(421614,$1)`, hash(n)); e != nil {
			t.Fatal(e)
		}
		if _, e := c.Exec(ctx, `INSERT INTO tickergarden.user_activity_blocks(chain_id,block_hash,manifest_hash,extractor_version,receipt_set_hash,record_count,records_hash) VALUES(421614,$1,$2,$3,$4,0,$5)`, hash(n), manifest, "user-event-roles-v1", receipt, "sha256:"+fmt.Sprintf("%064d", n)); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := c.Exec(ctx, `INSERT INTO tickergarden.event_projection_checkpoints(chain_id,manifest_hash,projector_version,start_block,tip_number,tip_hash) VALUES(421614,$1,'event-facts-v1',10,12,$2)`, manifest, hash(12)); e != nil {
		t.Fatal(e)
	}
	pc, e := pgxpool.ParseConfig(c.Config().ConnString())
	if e != nil {
		t.Fatal(e)
	}
	pc.ConnConfig.Database = c.Config().Database
	p, e := pgxpool.NewWithConfig(ctx, pc)
	if e != nil {
		t.Fatal(e)
	}
	defer p.Close()
	s, e := Load(ctx, p, Config{ChainID: 421614, StartBlock: 10, ManifestHash: manifest, ProjectorVersion: eventVersion})
	if e != nil || !s.Available {
		t.Fatalf("valid: %+v %v", s, e)
	}
	for _, tc := range []struct {
		name, q     string
		args        []any
		unavailable bool
	}{
		{"wrong-manifest", `UPDATE tickergarden.event_projection_checkpoints SET manifest_hash=$1`, []any{hash(88)}, true},
		{"wrong-version", `UPDATE tickergarden.event_projection_checkpoints SET projector_version='stale'`, nil, true},
		{"wrong-finalized-hash", `UPDATE tickergarden.chain_journal SET finalized_hash=$1`, []any{hash(11)}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, e := c.Exec(ctx, tc.q, tc.args...); e != nil {
				t.Fatal(e)
			}
			_, e := Load(ctx, p, Config{ChainID: 421614, StartBlock: 10, ManifestHash: manifest, ProjectorVersion: eventVersion})
			if tc.unavailable && e == nil {
				t.Fatal("expected unavailable")
			}
			if tc.name == "wrong-manifest" {
				c.Exec(ctx, `UPDATE tickergarden.event_projection_checkpoints SET manifest_hash=$1`, manifest)
			}
			if tc.name == "wrong-version" {
				c.Exec(ctx, `UPDATE tickergarden.event_projection_checkpoints SET projector_version='event-facts-v1'`)
			}
			if tc.name == "wrong-finalized-hash" {
				c.Exec(ctx, `UPDATE tickergarden.chain_journal SET finalized_hash=$1`, hash(12))
			}
		})
	}
	if _, e := c.Exec(ctx, `DELETE FROM tickergarden.user_activity_blocks WHERE block_hash=$1`, hash(11)); e != nil {
		t.Fatal(e)
	}
	s, e = Load(ctx, p, Config{ChainID: 421614, StartBlock: 10, ManifestHash: manifest, ProjectorVersion: eventVersion})
	if e != nil || s.Available || s.UserActivityThrough != 10 {
		t.Fatalf("activity gap: %+v %v", s, e)
	}
	if _, e := c.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified,receipt_set_hash,receipt_count) VALUES(421614,13,$1,$2,113,true,$3,0)`, hash(13), hash(12), receipt); e != nil {
		t.Fatal(e)
	}
	if _, e := c.Exec(ctx, `UPDATE tickergarden.event_projection_checkpoints SET tip_number=11,tip_hash=$1`, hash(11)); e != nil {
		t.Fatal(e)
	}
	s, e = Load(ctx, p, Config{ChainID: 421614, StartBlock: 10, ManifestHash: manifest, ProjectorVersion: eventVersion})
	if e != nil || s.Available || s.EventThrough != 11 {
		t.Fatalf("event behind: %+v %v", s, e)
	}
	if _, e := c.Exec(ctx, `UPDATE tickergarden.event_projection_checkpoints SET tip_number=13,tip_hash=$1`, hash(13)); e != nil {
		t.Fatal(e)
	}
	if _, e = Load(ctx, p, Config{ChainID: 421614, StartBlock: 10, ManifestHash: manifest, ProjectorVersion: eventVersion}); e == nil {
		t.Fatal("event ahead accepted")
	}
	if _, e := c.Exec(ctx, `UPDATE tickergarden.event_projection_checkpoints SET tip_number=12,tip_hash=$1`, hash(10)); e != nil {
		t.Fatal(e)
	}
	if _, e = Load(ctx, p, Config{ChainID: 421614, StartBlock: 10, ManifestHash: manifest, ProjectorVersion: eventVersion}); e == nil {
		t.Fatal("wrong tip hash accepted")
	}
}
