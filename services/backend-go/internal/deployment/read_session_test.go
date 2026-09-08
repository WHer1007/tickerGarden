package deployment

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"time"
)

type sessionFixture struct {
	BindingObserver
	calls   atomic.Int32
	fail    atomic.Bool
	headers atomic.Int32
}

func (f *sessionFixture) CallAt(context.Context, string, string, string) ([]byte, error) {
	f.calls.Add(1)
	time.Sleep(time.Millisecond)
	if f.fail.Load() {
		return nil, errors.New("unavailable")
	}
	return []byte{7}, nil
}
func (f *sessionFixture) Header(context.Context, string) (chainrpc.Header, error) {
	f.headers.Add(1)
	return chainrpc.Header{}, nil
}
func TestReadSessionIsolationAndRetry(t *testing.T) {
	ctx := context.Background()
	f := &sessionFixture{}
	s := NewReadSession(f, "hash-a")
	v, e := s.CallAt(ctx, "address", "data", "hash-a")
	if e != nil {
		t.Fatal(e)
	}
	v[0] = 99
	v, e = s.CallAt(ctx, "address", "data", "hash-a")
	if e != nil || v[0] != 7 || f.calls.Load() != 1 {
		t.Fatal("mutable cache or duplicate request")
	}
	if _, e = s.CallAt(ctx, "address", "data", "hash-b"); e == nil {
		t.Fatal("wrong block accepted")
	}
	s2 := NewReadSession(f, "hash-b")
	if _, e = s2.CallAt(ctx, "address", "data", "hash-b"); e != nil || f.calls.Load() != 2 {
		t.Fatal("cross-block reuse")
	}
	f.fail.Store(true)
	if _, e = s.CallAt(ctx, "other", "data", "hash-a"); e == nil {
		t.Fatal("error ignored")
	}
	f.fail.Store(false)
	if _, e = s.CallAt(ctx, "other", "data", "hash-a"); e != nil || f.calls.Load() != 4 {
		t.Fatal("failed read cached")
	}
	s.Header(ctx, "latest")
	s.Header(ctx, "latest")
	if f.headers.Load() != 2 {
		t.Fatal("canonical header cached")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, e = s.CallAt(canceled, "address", "data", "hash-a"); e == nil {
		t.Fatal("canceled read returned cache")
	}
}
func TestReadSessionConcurrentDedupAndFailedBatch(t *testing.T) {
	f := &sessionFixture{}
	s := NewReadSession(f, "hash")
	calls := make([]chainrpc.StateCall, 32)
	for i := range calls {
		calls[i] = chainrpc.StateCall{Address: "address", Data: "data"}
	}
	got, e := s.CallsAt(context.Background(), calls, "hash")
	if e != nil || len(got) != 32 || f.calls.Load() != 1 {
		t.Fatalf("dedup: %d %v", f.calls.Load(), e)
	}
	got[0][0] = 99
	if got[1][0] != 7 {
		t.Fatal("shared result slice")
	}
	f.fail.Store(true)
	if got, e = s.CallsAt(context.Background(), []chainrpc.StateCall{{Address: "fail"}}, "hash"); e == nil || got != nil {
		t.Fatal("partial failure returned")
	}
	stats := s.Stats()
	if stats.Hits != 31 || stats.Requests != 2 || stats.Errors != 1 {
		t.Fatalf("stats %+v", stats)
	}
}

type sessionIdentityFixture struct {
	sessionFixture
	chainCalls atomic.Int32
	changed    atomic.Bool
}

func (f *sessionIdentityFixture) ChainID(context.Context) (uint64, error) {
	f.chainCalls.Add(1)
	if f.changed.Load() {
		return 2, nil
	}
	return 1, nil
}
func (f *sessionIdentityFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	f.headers.Add(1)
	hash := "hash"
	if f.changed.Load() {
		hash = "changed"
	}
	return chainrpc.Header{Number: tag, Hash: hash}, nil
}
func TestReadSessionFixedIdentityAndLiveCommitFence(t *testing.T) {
	ctx := context.Background()
	f := &sessionIdentityFixture{}
	s := NewReadSession(f, "hash")
	for i := 0; i < 2; i++ {
		if n, e := s.ChainID(ctx); e != nil || n != 1 {
			t.Fatal("identity")
		}
		if _, e := s.Header(ctx, "0x1"); e != nil {
			t.Fatal(e)
		}
	}
	if f.chainCalls.Load() != 1 || f.headers.Load() != 1 {
		t.Fatal("repeated identity reads")
	}
	f.changed.Store(true)
	// The projector's commit fence bypasses the session; a fork cannot commit
	// just because the intra-attempt observations were cached.
	if h, _ := f.Header(ctx, "0x1"); h.Hash == "hash" {
		t.Fatal("live fence did not see fork")
	}
	if n, _ := f.ChainID(ctx); n == 1 {
		t.Fatal("live fence did not see chain change")
	}
	if _, e := NewReadSession(f, "hash").Header(ctx, "0x1"); e == nil {
		t.Fatal("wrong historical header accepted")
	}
	s.Header(ctx, "finalized")
	s.Header(ctx, "finalized")
	if f.headers.Load() != 5 {
		t.Fatal("moving tag cached")
	}
}

// Existing fixtures record reads in slices, so serialize fixture access while
// exercising the session's actual concurrent prefetch path.
type lockedFeeFixture struct {
	mu sync.Mutex
	f  *feeFixture
}

func (f *lockedFeeFixture) ChainID(c context.Context) (uint64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.f.ChainID(c)
}
func (f *lockedFeeFixture) Header(c context.Context, t string) (chainrpc.Header, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.f.Header(c, t)
}
func (f *lockedFeeFixture) CodeAt(c context.Context, a, h string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.f.CodeAt(c, a, h)
}
func (f *lockedFeeFixture) CallAt(c context.Context, a, d, h string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.f.CallAt(c, a, d, h)
}
func (f *lockedFeeFixture) BalanceAt(c context.Context, a, h string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.f.BalanceAt(c, a, h)
}
func TestReadSessionFinancialObservationEquivalence(t *testing.T) {
	for _, native := range []bool{false, true} {
		t.Run(fmt.Sprint(native), func(t *testing.T) {
			f, b, markets, roots, distributor, _ := continuousSetup(t, native)
			ctx := context.Background()
			want, e := ObserveFeeBlock(ctx, f, f.manifest, b, markets)
			if e != nil {
				t.Fatal(e)
			}
			holderWant, e := observeContinuousHolders(ctx, f, f.manifest, b, markets, roots, distributor, f.code[distributor])
			if e != nil {
				t.Fatal(e)
			}
			s := NewReadSession(&lockedFeeFixture{f: f}, b.Hash)
			got, e := ObserveFeeBlock(ctx, s, f.manifest, b, markets)
			if e != nil {
				t.Fatal(e)
			}
			holderGot, e := observeContinuousHolders(ctx, s, f.manifest, b, markets, roots, distributor, f.code[distributor])
			if e != nil {
				t.Fatal(e)
			}
			if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(holderGot, holderWant) {
				t.Fatal("financial observations changed")
			}
		})
	}
}

func TestReadSessionMemoryBoundFallsBackToFreshReads(t *testing.T) {
	f := &sessionFixture{}
	s := NewReadSession(f, "hash")
	s.bytes = 32 << 20
	for i := 0; i < 2; i++ {
		if _, e := s.CallAt(context.Background(), "address", "data", "hash"); e != nil {
			t.Fatal(e)
		}
	}
	if f.calls.Load() != 2 || len(s.values) != 0 {
		t.Fatal("cache exceeded its budget")
	}
}
