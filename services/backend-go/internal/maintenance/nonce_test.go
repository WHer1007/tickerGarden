package maintenance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
)

type nonceFixture struct {
	p          deployment.MaintenancePreview
	pending    uint64
	wrongChain bool
}

func (f nonceFixture) ChainID(context.Context) (uint64, error) {
	if f.wrongChain {
		return 4663, nil
	}
	return f.p.ChainID, nil
}
func (f nonceFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	if tag == "0x0" {
		return chainrpc.Header{Hash: f.p.GenesisHash}, nil
	}
	return chainrpc.Header{Number: f.p.BlockNumber, Hash: f.p.BlockHash, Timestamp: f.p.BlockTimestamp}, nil
}
func (f nonceFixture) PendingNonce(_ context.Context, sender string) (uint64, error) {
	if sender != f.p.From {
		return 0, errors.New("wrong sender")
	}
	return f.pending, nil
}
func noncePreview(p deployment.MaintenancePreview, i int) deployment.MaintenancePreview {
	p.From = "0x" + strings.Repeat("7", 40)
	p.Request.TriggerID = fmt.Sprintf("0x%064x", 1000+i)
	p.Key = deployment.Hash([]byte(strings.Join([]string{"V1-EXEC-11:maintenance-v1", "46630", p.GenesisHash, p.From, p.Module, p.To, p.Request.Operation, p.Request.MarketID, p.Request.User, p.Request.TriggerID}, ":")))
	return p
}
func TestIsolatedMaintenanceNonceReservations(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 10)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	store := Store{Pool: pool, ChainID: 46630}
	history, e := store.History(ctx, os.Getenv("TG_MAINTENANCE_TEST_KEY"), 0)
	if e != nil || len(history) == 0 {
		t.Fatal(e)
	}
	base := history[0].Preview
	results := make(chan Reservation, 8)
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Go(func() {
			p := noncePreview(base, i)
			token := fmt.Sprintf("0x%064x", 2000+i)
			if _, e := store.Record(ctx, p); e != nil {
				t.Error(e)
				return
			}
			l, e := store.AcquireLease(ctx, p.Key, "nonce-worker", token, 60)
			if e != nil {
				t.Error(e)
				return
			}
			r, e := store.ReserveNonce(ctx, nonceFixture{p: p, pending: 5}, p, l.Owner, l.Token, l.Generation)
			if e != nil {
				t.Error(e)
				return
			}
			again, e := store.ReserveNonce(ctx, nonceFixture{p: p, pending: 999}, p, l.Owner, l.Token, l.Generation)
			if e != nil || again != r {
				t.Error("retry changed nonce", again, e)
				return
			}
			restored, e := store.Reservation(ctx, p.Key)
			if e != nil || restored != r {
				t.Error("reservation read", restored, e)
				return
			}
			results <- r
		})
	}
	wg.Wait()
	close(results)
	nonces := []int{}
	var first Reservation
	for r := range results {
		first = r
		n, e := strconv.Atoi(r.Nonce)
		if e != nil {
			t.Fatal(e)
		}
		nonces = append(nonces, n)
	}
	sort.Ints(nonces)
	if fmt.Sprint(nonces) != "[5 6 7 8 9 10 11 12]" {
		t.Fatal("nonce collision/gap", nonces)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, first.JobKey); e != nil {
		t.Fatal(e)
	}
	if _, e = store.AcquireLease(ctx, first.JobKey, "recovery", fmt.Sprintf("0x%064x", 9000), 60); !errors.Is(e, ErrNonceReserved) {
		t.Fatal("reserved job reacquired", e)
	}
	if _, e = store.Reservation(ctx, first.JobKey); e != nil {
		t.Fatal("expired reservation lost", e)
	}
	p := noncePreview(base, 9)
	if _, e = store.Record(ctx, p); e != nil {
		t.Fatal(e)
	}
	l, e := store.AcquireLease(ctx, p.Key, "nonce-worker", fmt.Sprintf("0x%064x", 2010), 60)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.ReserveNonce(ctx, nonceFixture{p: p, pending: 100, wrongChain: true}, p, l.Owner, l.Token, l.Generation); e == nil {
		t.Fatal("wrong chain RPC accepted")
	}
	if _, e = store.Reservation(ctx, p.Key); e == nil {
		t.Fatal("failed RPC left reservation")
	}
	if _, e = store.ReserveNonce(ctx, nonceFixture{p: p, pending: 100}, p, l.Owner, l.Token, l.Generation+1); !errors.Is(e, ErrLeaseLost) {
		t.Fatal("stale fence accepted", e)
	}
	r, e := store.ReserveNonce(ctx, nonceFixture{p: p, pending: 100}, p, l.Owner, l.Token, l.Generation)
	if e != nil || r.Nonce != "100" {
		t.Fatal("pending nonce advance", r, e)
	}
}
