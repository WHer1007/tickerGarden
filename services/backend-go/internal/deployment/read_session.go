package deployment

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
	"tickergarden/backend/internal/chainrpc"
)

// ReadSession shares successful immutable reads within ONE projector attempt.
// Never reuse across blocks/retries. Only genesis and the pinned historical
// header may be reused. The caller MUST recheck chain identity and the canonical
// header through the underlying observer before committing. Moving tags stay live.
type ReadSession struct {
	BindingObserver
	hash     string
	mu       sync.Mutex
	values   map[string][]byte
	inflight map[string]chan struct{}
	bytes    int
	stats    ReadStats
}
type ReadStats struct {
	Requests       uint64 `json:"requests"`
	Hits           uint64 `json:"cacheHits"`
	Errors         uint64 `json:"errors"`
	UpstreamMillis int64  `json:"upstreamMillis"`
}

func NewReadSession(rpc BindingObserver, hash string) *ReadSession {
	return &ReadSession{BindingObserver: rpc, hash: hash, values: map[string][]byte{}, inflight: map[string]chan struct{}{}}
}
func (s *ReadSession) Stats() ReadStats { s.mu.Lock(); defer s.mu.Unlock(); return s.stats }
func (s *ReadSession) read(ctx context.Context, key, hash string, fetch func() ([]byte, error)) ([]byte, error) {
	if hash != s.hash {
		return nil, errors.New("read session hash mismatch")
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		s.mu.Lock()
		if v, ok := s.values[key]; ok {
			s.stats.Hits++
			out := append([]byte{}, v...)
			s.mu.Unlock()
			return out, nil
		}
		if wait, ok := s.inflight[key]; ok {
			s.mu.Unlock()
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		wait := make(chan struct{})
		s.inflight[key] = wait
		s.stats.Requests++
		s.mu.Unlock()
		start := time.Now()
		v, err := fetch()
		s.mu.Lock()
		s.stats.UpstreamMillis += time.Since(start).Milliseconds()
		if err != nil {
			s.stats.Errors++
		} else if len(s.values) < 65536 && s.bytes+len(v)+len(key) <= 32<<20 {
			s.values[key] = append([]byte{}, v...)
			s.bytes += len(v) + len(key)
		}
		delete(s.inflight, key)
		close(wait)
		s.mu.Unlock()
		return append([]byte{}, v...), err
	}
}
func (s *ReadSession) CodeAt(ctx context.Context, a, h string) ([]byte, error) {
	return s.read(ctx, "code:"+a, h, func() ([]byte, error) { return s.BindingObserver.CodeAt(ctx, a, h) })
}
func (s *ReadSession) CallAt(ctx context.Context, a, d, h string) ([]byte, error) {
	return s.read(ctx, "call:"+a+":"+d, h, func() ([]byte, error) { return s.BindingObserver.CallAt(ctx, a, d, h) })
}
func (s *ReadSession) BalanceAt(ctx context.Context, a, h string) (string, error) {
	v, e := s.read(ctx, "balance:"+a, h, func() ([]byte, error) {
		r, ok := s.BindingObserver.(interface {
			BalanceAt(context.Context, string, string) (string, error)
		})
		if !ok {
			return nil, errors.New("native balance observer required")
		}
		v, e := r.BalanceAt(ctx, a, h)
		return []byte(v), e
	})
	return string(v), e
}
func (s *ReadSession) batch(ctx context.Context, n int, read func(context.Context, int) ([]byte, error)) ([][]byte, error) {
	if n == 0 || n > 256 {
		return nil, errors.New("invalid session batch size")
	}
	out := make([][]byte, n)
	g, c := errgroup.WithContext(ctx)
	g.SetLimit(4)
	for i := 0; i < n; i++ {
		g.Go(func() error { v, e := read(c, i); out[i] = v; return e })
	}
	if e := g.Wait(); e != nil {
		return nil, e
	}
	return out, nil
}
func (s *ReadSession) CodesAt(ctx context.Context, a []string, h string) ([][]byte, error) {
	return s.batch(ctx, len(a), func(c context.Context, i int) ([]byte, error) { return s.CodeAt(c, a[i], h) })
}
func (s *ReadSession) CallsAt(ctx context.Context, a []chainrpc.StateCall, h string) ([][]byte, error) {
	return s.batch(ctx, len(a), func(c context.Context, i int) ([]byte, error) { return s.CallAt(c, a[i].Address, a[i].Data, h) })
}

// Observe forwards the complete receipt/log observation for the session's
// pinned block. It is intentionally not cached: receipt verification remains
// an independent input and callers still perform their end-of-attempt fence.
func (s *ReadSession) Observe(ctx context.Context, h chainrpc.Header) (chainrpc.Observation, error) {
	if !strings.EqualFold(h.Hash, s.hash) {
		return chainrpc.Observation{}, errors.New("read session observation hash mismatch")
	}
	rpc, ok := s.BindingObserver.(interface {
		Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error)
	})
	if !ok {
		return chainrpc.Observation{}, errors.New("read session observation unavailable")
	}
	return rpc.Observe(ctx, h)
}

// Chain identity and fixed headers are scoped to this attempt, like state reads.
// This session is only used inside a projector transaction with a live end fence.
func (s *ReadSession) ChainID(ctx context.Context) (uint64, error) {
	v, e := s.read(ctx, "chain-id", s.hash, func() ([]byte, error) {
		n, e := s.BindingObserver.ChainID(ctx)
		if e != nil {
			return nil, e
		}
		return json.Marshal(n)
	})
	if e != nil {
		return 0, e
	}
	var n uint64
	e = json.Unmarshal(v, &n)
	return n, e
}
func (s *ReadSession) Header(ctx context.Context, tag string) (chainrpc.Header, error) {
	if !strings.HasPrefix(tag, "0x") {
		return s.BindingObserver.Header(ctx, tag)
	}
	v, e := s.read(ctx, "header:"+tag, s.hash, func() ([]byte, error) {
		h, e := s.BindingObserver.Header(ctx, tag)
		if e != nil {
			return nil, e
		}
		if tag != "0x0" && !strings.EqualFold(h.Hash, s.hash) {
			return nil, errors.New("read session canonical header mismatch")
		}
		return json.Marshal(h)
	})
	if e != nil {
		return chainrpc.Header{}, e
	}
	var h chainrpc.Header
	e = json.Unmarshal(v, &h)
	return h, e
}
