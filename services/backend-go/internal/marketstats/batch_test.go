package marketstats

import (
	"context"
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

type batchRPC struct {
	project, burn, pool int
	last                []string
}

func (r *batchRPC) Header(context.Context, string) (chainrpc.Header, error) {
	return chainrpc.Header{}, nil
}
func (r *batchRPC) CallAt(context.Context, string, string, string) ([]byte, error) { return nil, nil }
func (r *batchRPC) ProjectLogs(_ context.Context, addresses, _ []string, _, _ uint64) ([]chainrpc.Log, error) {
	r.project++
	r.last = append([]string(nil), addresses...)
	out := []chainrpc.Log{}
	for _, a := range addresses {
		out = append(out, chainrpc.Log{Address: a})
	}
	return out, nil
}
func (r *batchRPC) BurnLogs(context.Context, string, string, uint64, uint64) ([]chainrpc.Log, error) {
	return nil, nil
}
func (r *batchRPC) BurnLogsFor(_ context.Context, tokens []string, _ string, _, _ uint64) ([]chainrpc.Log, error) {
	r.burn++
	r.last = append([]string(nil), tokens...)
	out := []chainrpc.Log{}
	for _, a := range tokens {
		out = append(out, chainrpc.Log{Address: a})
	}
	return out, nil
}
func (r *batchRPC) PoolLogs(_ context.Context, _ string, _ []string, pools []string, _, _ uint64) ([]chainrpc.Log, error) {
	r.pool++
	r.last = append([]string(nil), pools...)
	out := []chainrpc.Log{}
	for _, a := range pools {
		out = append(out, chainrpc.Log{Address: a, Topics: []string{"topic", a}})
	}
	return out, nil
}

func TestRangeRPCSharesSameCursorRangesAcrossMarkets(t *testing.T) {
	a, b := "0xcurve-a", "0xcurve-b"
	r := &batchRPC{}
	x := &rangeRPC{RPC: r, states: []State{{Curve: a, Token: "0xtoken-a", Pool: "0xpool-a", Manager: "0xmanager", Phase: "1", Cursor: 9}, {Curve: b, Token: "0xtoken-b", Pool: "0xpool-b", Manager: "0xmanager", Phase: "1", Cursor: 9}}, headers: map[string]chainrpc.Header{}, logs: map[string][]chainrpc.Log{}}
	if got, _ := x.ProjectLogs(context.Background(), []string{a}, nil, 10, 20); len(got) != 1 || r.project != 1 || len(r.last) != 2 {
		t.Fatalf("curve batch got=%v calls=%d scope=%v", got, r.project, r.last)
	}
	if got, _ := x.ProjectLogs(context.Background(), []string{b}, nil, 10, 20); len(got) != 1 || r.project != 1 {
		t.Fatalf("curve cache got=%v calls=%d", got, r.project)
	}
	if got, _ := x.PoolLogs(context.Background(), "0xmanager", nil, []string{"0xpool-a"}, 10, 20); len(got) != 1 || r.pool != 1 || len(r.last) != 2 {
		t.Fatalf("pool batch got=%v calls=%d scope=%v", got, r.pool, r.last)
	}
	if got, _ := x.BurnLogs(context.Background(), "0xtoken-a", "topic", 10, 20); len(got) != 1 || r.burn != 1 || len(r.last) != 2 {
		t.Fatalf("burn batch got=%v calls=%d scope=%v", got, r.burn, r.last)
	}
}
