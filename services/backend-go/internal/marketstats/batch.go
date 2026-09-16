package marketstats

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"tickergarden/backend/internal/chainrpc"
)

// rangeRPC coalesces identical ranges across up to 64 markets. Its lifetime is
// one worker tick, so no returned header or log response survives a reorg check.
type rangeRPC struct {
	RPC
	mu      sync.Mutex
	states  []State
	headers map[string]chainrpc.Header
	logs    map[string][]chainrpc.Log
}

func (r *rangeRPC) Header(ctx context.Context, tag string) (chainrpc.Header, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if h, ok := r.headers[tag]; ok {
		return h, nil
	}
	h, e := r.RPC.Header(ctx, tag)
	if e == nil {
		r.headers[tag] = h
	}
	return h, e
}
func (r *rangeRPC) group(who string, from uint64, kind string, manager string) []string {
	list := []string{}
	for _, s := range r.states {
		if s.Cursor+1 != from {
			continue
		}
		v := s.Curve
		if kind == "burn" {
			v = s.Token
		}
		if kind == "pool" {
			if s.Phase != "1" || s.Manager != manager {
				continue
			}
			v = s.Pool
		}
		list = append(list, v)
	}
	for i, v := range list {
		if v == who {
			start := i / 64 * 64
			return list[start:min(start+64, len(list))]
		}
	}
	return []string{who}
}
func (r *rangeRPC) ProjectLogs(ctx context.Context, addresses, topics []string, from, to uint64) ([]chainrpc.Log, error) {
	if len(addresses) != 1 {
		return r.RPC.ProjectLogs(ctx, addresses, topics, from, to)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	group := r.group(addresses[0], from, "curve", "")
	key := fmt.Sprint("curve", group, topics, from, to)
	all, ok := r.logs[key]
	if !ok {
		var e error
		all, e = r.RPC.ProjectLogs(ctx, group, topics, from, to)
		if e != nil {
			return nil, e
		}
		r.logs[key] = all
	}
	out := []chainrpc.Log{}
	for _, l := range all {
		if l.Address == addresses[0] {
			out = append(out, l)
		}
	}
	return out, nil
}
func (r *rangeRPC) BurnLogs(ctx context.Context, token, topic string, from, to uint64) ([]chainrpc.Log, error) {
	bulk, ok := r.RPC.(interface {
		BurnLogsFor(context.Context, []string, string, uint64, uint64) ([]chainrpc.Log, error)
	})
	if !ok {
		return r.RPC.BurnLogs(ctx, token, topic, from, to)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	group := r.group(token, from, "burn", "")
	key := fmt.Sprint("burn", group, from, to)
	all, ok := r.logs[key]
	if !ok {
		var e error
		all, e = bulk.BurnLogsFor(ctx, group, topic, from, to)
		if e != nil {
			return nil, e
		}
		r.logs[key] = all
	}
	out := []chainrpc.Log{}
	for _, l := range all {
		if l.Address == token {
			out = append(out, l)
		}
	}
	return out, nil
}
func (r *rangeRPC) PoolLogs(ctx context.Context, manager string, topics, pools []string, from, to uint64) ([]chainrpc.Log, error) {
	if len(pools) != 1 {
		return r.RPC.PoolLogs(ctx, manager, topics, pools, from, to)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	group := r.group(pools[0], from, "pool", manager)
	key := fmt.Sprint(manager, group, topics, from, to)
	all, ok := r.logs[key]
	if !ok {
		var e error
		all, e = r.RPC.PoolLogs(ctx, manager, topics, group, from, to)
		if e != nil {
			return nil, e
		}
		r.logs[key] = all
	}
	out := []chainrpc.Log{}
	for _, l := range all {
		if len(l.Topics) > 1 && strings.EqualFold(l.Topics[1], pools[0]) {
			out = append(out, l)
		}
	}
	return out, nil
}
