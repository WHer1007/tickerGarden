package maintenance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"tickergarden/backend/internal/postgres"
)

func TestLeaseInputBoundaries(t *testing.T) {
	key, token := fmt.Sprintf("0x%064x", 1), fmt.Sprintf("0x%064x", 2)
	if !validLeaseInput(key, "worker-1", token, 10) || !validLeaseInput(key, "worker:2", token, 300) {
		t.Fatal("valid bounds rejected")
	}
	for _, ttl := range []int{-1, 0, 9, 301} {
		if validLeaseInput(key, "worker", token, ttl) {
			t.Fatal("invalid ttl")
		}
	}
	for _, owner := range []string{"", "a b", "/worker"} {
		if validLeaseInput(key, owner, token, 60) {
			t.Fatal("invalid owner")
		}
	}
	if validLeaseInput(key, "worker", fmt.Sprintf("0x%064x", 0), 60) {
		t.Fatal("zero token")
	}
}
func TestIsolatedMaintenanceLeases(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated maintenance database not supplied")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 8)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	store := Store{Pool: pool, ChainID: 46630}
	key := os.Getenv("TG_MAINTENANCE_TEST_KEY")
	winners := make(chan Lease, 12)
	var wg sync.WaitGroup
	for i := range 12 {
		wg.Go(func() {
			l, e := store.AcquireLease(ctx, key, fmt.Sprintf("worker-%d", i), fmt.Sprintf("0x%064x", i+1), 60)
			if e == nil {
				winners <- l
			} else if !errors.Is(e, ErrLeaseBusy) {
				t.Errorf("unexpected acquire error: %v", e)
			}
		})
	}
	wg.Wait()
	close(winners)
	var current Lease
	count := 0
	for l := range winners {
		current = l
		count++
	}
	if count != 1 || current.Generation != 1 {
		t.Fatalf("winners=%d lease=%+v", count, current)
	}
	same, e := store.AcquireLease(ctx, key, current.Owner, current.Token, 60)
	if e != nil || same != current {
		t.Fatal("retry changed lease", same, e)
	}
	if _, e = store.ChangeLease(ctx, key, "wrong-owner", current.Token, 1, false); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("wrong owner renewed", e)
	}
	renewed, e := store.ChangeLease(ctx, key, current.Owner, current.Token, 1, false)
	if e != nil || renewed.ExpiresAt.Before(current.ExpiresAt) {
		t.Fatal("renew", renewed, e)
	}
	released, e := store.ChangeLease(ctx, key, current.Owner, current.Token, 1, true)
	if e != nil || !released.Released {
		t.Fatal("release", released, e)
	}
	duplicate, e := store.ChangeLease(ctx, key, current.Owner, current.Token, 1, true)
	if e != nil || duplicate != released {
		t.Fatal("release retry", duplicate, e)
	}
	next, e := store.AcquireLease(ctx, key, "replacement", fmt.Sprintf("0x%064x", 100), 60)
	if e != nil || next.Generation != 2 {
		t.Fatal("replacement", next, e)
	}
	for _, release := range []bool{false, true} {
		if _, e = store.ChangeLease(ctx, key, current.Owner, current.Token, 1, release); !errors.Is(e, ErrLeaseLost) {
			t.Fatal("stale fence accepted", e)
		}
	}
	if _, e = store.AcquireLease(ctx, key, current.Owner, current.Token, 60); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("old token reused", e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1 AND generation=2`, key); e != nil {
		t.Fatal(e)
	}
	if _, e = store.ChangeLease(ctx, key, next.Owner, next.Token, 2, false); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("expired lease revived", e)
	}
	if _, e = store.AcquireLease(ctx, key, next.Owner, next.Token, 60); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("expired acquisition reused", e)
	}
	fresh, e := store.AcquireLease(ctx, key, "after-expiry", fmt.Sprintf("0x%064x", 101), 60)
	if e != nil || fresh.Generation != 3 {
		t.Fatal("expiry takeover", fresh, e)
	}
	wrong := Store{Pool: pool, ChainID: 4663}
	if _, e = wrong.AcquireLease(ctx, key, "other", fmt.Sprintf("0x%064x", 102), 60); !errors.Is(e, ErrUnavailable) {
		t.Fatal("wrong chain", e)
	}
	var events int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_lease_events WHERE job_key=$1`, key).Scan(&events); e != nil || events != 5 {
		t.Fatal("audit count", events, e)
	}
	if _, e = store.ChangeLease(ctx, key, fresh.Owner, fresh.Token, 3, true); e != nil {
		t.Fatal(e)
	}
}
