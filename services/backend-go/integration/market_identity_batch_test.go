package integration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/marketidentity"
)

type countedIdentityQuery struct {
	pgx.Tx
	calls int
}

func (q *countedIdentityQuery) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	q.calls++
	return q.Tx.Query(ctx, sql, args...)
}

func testMarketIdentityBatch(t *testing.T, ctx context.Context, pool *pgxpool.Pool, original deployment.MarketIdentity, manifest string, source chainrpc.Log) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	const size = 1000
	ids := make([]string, size)
	logs, discoveries, identities := [][]any{}, [][]any{}, [][]any{}
	for i := range size {
		id := hash(10000 + i)
		token := fmt.Sprintf("0x%040x", 20000+i)
		ids[i] = id
		log := source
		log.LogIndex = fmt.Sprintf("0x%x", i+1)
		logRaw, _ := json.Marshal(log)
		discovery := deployment.MarketDiscovery{MarketID: id, Source: log, State: map[string]any{"memeToken": token}}
		discoveryRaw, _ := json.Marshal(discovery)
		identity := original
		identity.MarketID = id
		identity.MemeToken = token
		identity.Name = fmt.Sprintf("Catalog %04d", i)
		raw, _ := json.Marshal(identity)
		digest := sha256.Sum256(raw)
		logs = append(logs, []any{original.ChainID, source.BlockHash, i + 1, source.Address, logRaw})
		discoveries = append(discoveries, []any{original.ChainID, source.BlockHash, id, i + 1, discoveryRaw})
		identities = append(identities, []any{original.ChainID, source.BlockHash, id, manifest, raw, hex.EncodeToString(digest[:])})
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
		if _, err = tx.CopyFrom(ctx, pgx.Identifier{"tickergarden", copy.table}, copy.columns, pgx.CopyFromRows(copy.rows)); err != nil {
			t.Fatal(err)
		}
	}
	q := &countedIdentityQuery{Tx: tx}
	started := time.Now()
	batch, err := marketidentity.LoadManyAt(ctx, q, original.ChainID, ids, source.BlockHash)
	elapsed := time.Since(started)
	if err != nil || len(batch) != size || q.calls != 1 {
		t.Fatalf("batch count=%d queries=%d error=%v", len(batch), q.calls, err)
	}
	started = time.Now()
	for _, id := range ids {
		single, e := marketidentity.LoadAt(ctx, tx, original.ChainID, id, source.BlockHash)
		if e != nil || !reflect.DeepEqual(single, batch[id]) {
			t.Fatal("batch differs from single identity", id, e)
		}
	}
	t.Logf("identity catalog %d: batch %s (1 query), prior single path %s (%d queries)", size, elapsed, time.Since(started), size)
	for _, bad := range [][]string{{ids[0], ids[0]}, {ids[0], hash(999999)}, {"invalid"}} {
		got, e := marketidentity.LoadManyAt(ctx, q, original.ChainID, bad, source.BlockHash)
		if e == nil || got != nil {
			t.Fatal("partial or invalid set accepted")
		}
	}
	// Individually valid SQL rows whose token provenance disagrees must reject
	// the whole batch, even when the affected item is not first in input order.
	if _, err = tx.Exec(ctx, `UPDATE tickergarden.discovered_markets SET payload=jsonb_set(payload,'{state,memeToken}',to_jsonb($1::text)) WHERE chain_id=$2 AND market_id=$3`, fmt.Sprintf("0x%040x", 99999), original.ChainID, ids[size-1]); err != nil {
		t.Fatal(err)
	}
	if got, e := marketidentity.LoadManyAt(ctx, q, original.ChainID, ids, source.BlockHash); e == nil || got != nil {
		t.Fatal("mismatched token returned partial catalog")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if got, e := marketidentity.LoadManyAt(canceled, q, original.ChainID, ids, source.BlockHash); e == nil || got != nil {
		t.Fatal("canceled read accepted")
	}
}
