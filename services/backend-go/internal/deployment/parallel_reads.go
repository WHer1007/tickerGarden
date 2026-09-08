package deployment

import (
	"context"
	"errors"
	"tickergarden/backend/internal/chainrpc"
)

type parallelCodes interface {
	CodesAt(context.Context, []string, string) ([][]byte, error)
}
type parallelCalls interface {
	CallsAt(context.Context, []chainrpc.StateCall, string) ([][]byte, error)
}
type prefetchedReads struct {
	BindingObserver
	hash   string
	values map[string][]byte
}

func (r prefetchedReads) CallAt(ctx context.Context, a, d, h string) ([]byte, error) {
	if h != r.hash {
		return nil, errors.New("prefetched read hash mismatch")
	}
	if v, ok := r.values[a+d]; ok {
		return v, nil
	}
	return r.BindingObserver.CallAt(ctx, a, d, h)
}

// Optional optimization for real clients. Sequential fixture/custom observers
// retain their existing behavior. Cached results are scoped to one exact hash.
func prefetchCalls(ctx context.Context, rpc BindingObserver, hash string, calls []chainrpc.StateCall) (BindingObserver, error) {
	parallel, ok := rpc.(parallelCalls)
	if !ok {
		return rpc, nil
	}
	values, e := parallel.CallsAt(ctx, calls, hash)
	if e != nil {
		return nil, e
	}
	if len(values) != len(calls) {
		return nil, errors.New("incomplete fixed-hash call batch")
	}
	cached := prefetchedReads{BindingObserver: rpc, hash: hash, values: map[string][]byte{}}
	for i, c := range calls {
		cached.values[c.Address+c.Data] = values[i]
	}
	return cached, nil
}
