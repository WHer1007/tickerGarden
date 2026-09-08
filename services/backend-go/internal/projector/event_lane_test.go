package projector

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"os"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/projection"
	"time"
)

func eventTestDB(t *testing.T) *pgx.Conn {
	t.Helper()
	if os.Getenv("TG_TEST_EVENT_LANE") != "1" {
		t.Skip("set TG_TEST_EVENT_LANE=1")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid database URL")
	}
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal("database unavailable")
	}
	t.Cleanup(func() { admin.Close(context.Background()) })
	name := fmt.Sprintf("tg_event_lane_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, err := admin.Exec(cleanup, "DROP DATABASE "+quoted+" WITH (FORCE)"); err != nil {
			t.Error(err)
		}
	})
	cfg = cfg.Copy()
	cfg.Database = name
	db := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { db.Close() })
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
	t.Cleanup(func() { conn.Close(context.Background()) })

	return conn
}

type eventTestRPC struct {
	deployment.BindingObserver
	changed bool
}

func (r eventTestRPC) ChainID(context.Context) (uint64, error) { return 421614, nil }
func eventHeader(n uint64) chainrpc.Header {
	return chainrpc.Header{Number: fmt.Sprintf("0x%x", n), Hash: fmt.Sprintf("0x%064x", n), ParentHash: fmt.Sprintf("0x%064x", n-1), Timestamp: fmt.Sprintf("0x%x", 100+n)}
}
func (r eventTestRPC) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	var n uint64
	fmt.Sscanf(tag, "0x%x", &n)
	h := eventHeader(n)
	if r.changed {
		h.Hash = eventHeader(99).Hash
	}
	return h, nil
}
func TestEventLaneSQLIsolation(t *testing.T) {
	fast := Worker{EventsOnly: true}
	slow := Worker{}
	if fast.leaseKey(421614) == slow.leaseKey(421614) || fast.version() == slow.version() {
		t.Fatal("shared lane identity")
	}
	q := "SELECT * FROM tickergarden.projection_rows JOIN tickergarden.canonical_projection_rows USING(chain_id)"
	if slow.sqlForLane(q) != q || fast.sqlForLane(q) == q {
		t.Fatal("wrong table routing")
	}
}
func TestEventLanePostgresBoundaries(t *testing.T) {
	c := eventTestDB(t)
	ctx := context.Background()
	exec := func(q string, a ...any) {
		t.Helper()
		if _, e := c.Exec(ctx, q, a...); e != nil {
			t.Fatal(e)
		}
	}
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(421614,$1,10,12,$2,12,$2)`, eventHeader(1).Hash, eventHeader(12).Hash)
	for n := uint64(10); n <= 12; n++ {
		h := eventHeader(n)
		exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES(421614,$1,$2,$3,$4,true)`, n, h.Hash, h.ParentHash, 100+n)
	}
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES(421614,$1,10,12,$2)`, eventHeader(2).Hash, eventHeader(12).Hash)
	for n := uint64(10); n <= 12; n++ {
		exec(`INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES(421614,$1)`, eventHeader(n).Hash)
	}
	for _, scenario := range []string{"empty", "stop-at-event", "gap", "reorg", "finality-bound", "unrelated-log"} {
		t.Run(scenario, func(t *testing.T) {
			exec(`DELETE FROM tickergarden.event_projection_checkpoints`)
			exec(`DELETE FROM tickergarden.chain_logs`)
			exec(`UPDATE tickergarden.chain_blocks SET canonical=true`)
			exec(`INSERT INTO tickergarden.event_projection_checkpoints(chain_id,manifest_hash,projector_version,start_block) VALUES(421614,$1,$2,10)`, eventHeader(2).Hash, EventVersion)
			if scenario == "stop-at-event" || scenario == "unrelated-log" {
				exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES(421614,$1,0,'emitter','{}')`, eventHeader(11).Hash)
			}
			if scenario == "gap" {
				exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE number=11`)
			}
			tx, e := c.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer tx.Rollback(ctx)
			w := Worker{EventsOnly: true, RPC: eventTestRPC{changed: scenario == "reorg"}, cache: projection.New(), cacheEventsOnly: true, cacheHash: eventHeader(10).ParentHash}
			// Distinct advisory lock namespaces are exercised in the same database.
			if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", (&Worker{}).leaseKey(421614)); e != nil {
				t.Fatal(e)
			}
			ceiling := uint64(12)
			if scenario == "finality-bound" {
				ceiling = 11
			}
			var got Result
			if scenario == "unrelated-log" {
				got, e = w.finishEmptyEvents(ctx, tx, 421614, eventHeader(10), 0, ceiling, []string{"other-contract"})
			} else {
				got, e = w.finishEmptyEvents(ctx, tx, 421614, eventHeader(10), 0, ceiling)
			}
			if scenario == "gap" || scenario == "reorg" {
				if e == nil {
					t.Fatal("invalid evidence committed")
				}
				return
			}
			want := ceiling
			if scenario == "stop-at-event" {
				want = 10
			}
			if e != nil || got.BlockNumber == nil || *got.BlockNumber != want {
				t.Fatalf("%+v %v", got, e)
			}
			if w.cacheHash != eventHeader(want).Hash {
				t.Fatal("empty range cache did not advance with committed checkpoint")
			}
			var heavy int
			if e = c.QueryRow(ctx, `SELECT count(*) FROM tickergarden.projection_checkpoints`).Scan(&heavy); e != nil || heavy != 0 {
				t.Fatal("heavy checkpoint was modified")
			}
		})
	}
}
