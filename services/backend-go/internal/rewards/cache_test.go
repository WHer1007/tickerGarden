package rewards

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"sync"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestVerifiedCacheIsolationAndKey(t *testing.T) {
	var c verifiedCache
	original := []deployment.StateObservation{{Kind: "rewardPosition", Key: "a", Value: map[string]any{"amount": "7", "nested": map[string]any{"valid": true}}}}
	c.put("snapshot-a", original)
	original[0].Value["amount"] = "99"
	got, ok := c.get("snapshot-a")
	if !ok || got[0].Value["amount"] != "7" {
		t.Fatal(got, ok)
	}
	got[0].Value["nested"].(map[string]any)["valid"] = false
	fresh, _ := c.get("snapshot-a")
	if fresh[0].Value["nested"].(map[string]any)["valid"] != true {
		t.Fatal("shared mutable result")
	}
	if _, ok = c.get("snapshot-b"); ok {
		t.Fatal("wrong snapshot reused")
	}
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			for range 10 {
				c.put("snapshot-a", fresh)
				c.get("snapshot-a")
			}
		})
	}
	wg.Wait()
}

// Invoked only by the isolated Anvil/Postgres smoke fixture. Never accepts the
// user's ordinary API DSN; the dedicated environment opt-in is required.
func TestIsolatedRewardCache(t *testing.T) {
	dsn := os.Getenv("TG_REWARDS_CACHE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated fixture required")
	}
	ctx := context.Background()
	pool, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	var version, scope string
	e = pool.QueryRow(ctx, `SELECT p.projector_version,o.scope FROM tickergarden.projection_checkpoints p JOIN tickergarden.projection_observation_batches o ON o.chain_id=p.chain_id AND o.block_hash=p.tip_hash WHERE p.chain_id=46630`).Scan(&version, &scope)
	if e != nil {
		t.Fatal(e)
	}
	store := Store{Pool: pool, ChainID: 46630, Version: version, Scope: scope}
	user := os.Getenv("TG_REWARDS_CACHE_TEST_USER")
	first, e := store.LoadRewards(ctx, user, "")
	if e != nil || len(first.Items) == 0 {
		t.Fatal(first, e)
	}
	for range 5 {
		if _, e = store.LoadRewards(ctx, user, ""); e != nil {
			t.Fatal(e)
		}
	}
	if store.cache.hits == 0 {
		t.Fatal("stable read snapshots never reused")
	}
	t.Logf("verified cache hits: %d", store.cache.hits)
	first.Items[0].Value["unpaidAmount"] = "corrupt"
	next, e := store.LoadRewards(ctx, user, "")
	if e != nil || next.Items[0].Value["unpaidAmount"] == "corrupt" {
		t.Fatal("caller changed cache", e)
	}
	if _, e = pool.Exec(ctx, "UPDATE tickergarden.projection_checkpoints SET input_count=input_count+1 WHERE chain_id=46630"); e != nil {
		t.Fatal(e)
	}
	defer func() {
		if _, e := pool.Exec(ctx, "UPDATE tickergarden.projection_checkpoints SET input_count=input_count-1 WHERE chain_id=46630"); e != nil {
			t.Error(e)
		}
	}()
	if _, e = store.LoadRewards(ctx, user, ""); e != ErrUnavailable {
		t.Fatal("committed corruption reused cache", e)
	}
}
