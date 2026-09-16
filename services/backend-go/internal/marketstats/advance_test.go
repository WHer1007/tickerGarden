package marketstats

import (
	"context"
	"fmt"
	"math/big"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
	"time"
)

type rpcFixture struct {
	calls, logCalls int
	ranges          [][2]uint64
	logs            []chainrpc.Log
	headers         map[string]chainrpc.Header
}

func (f *rpcFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	if h, ok := f.headers[tag]; ok {
		return h, nil
	}
	return chainrpc.Header{Number: tag, Timestamp: "0x1", Hash: "0x" + strings.Repeat("a", 64)}, nil
}
func (f *rpcFixture) CallAt(_ context.Context, target, data, hash string) ([]byte, error) {
	f.calls++
	if strings.HasPrefix(data, deployment.Hash([]byte("totalSupply()"))[:10]) {
		return new(big.Int).SetUint64(100).FillBytes(make([]byte, 32)), nil
	}
	if strings.HasPrefix(data, deployment.Hash([]byte("getReserves()"))[:10]) {
		return append(big.NewInt(10).FillBytes(make([]byte, 32)), big.NewInt(100).FillBytes(make([]byte, 32))...), nil
	}
	return nil, fmt.Errorf("unexpected call")
}
func (f *rpcFixture) ProjectLogs(_ context.Context, _, _ []string, from, to uint64) ([]chainrpc.Log, error) {
	f.logCalls++
	f.ranges = append(f.ranges, [2]uint64{from, to})
	return f.logs, nil
}
func (f *rpcFixture) PoolLogs(context.Context, string, []string, []string, uint64, uint64) ([]chainrpc.Log, error) {
	return nil, nil
}
func (f *rpcFixture) BurnLogs(context.Context, string, string, uint64, uint64) ([]chainrpc.Log, error) {
	return nil, nil
}
func TestEmptyRangesAdvanceWithoutStateCalls(t *testing.T) {
	rpc := &rpcFixture{}
	s := Service{RPC: rpc}
	h := chainrpc.Header{Number: "0xc", Timestamp: "0x1", Hash: "0x" + strings.Repeat("a", 64)}
	v := State{Cursor: 10, Hash: h.Hash, Phase: "0", StatsAt: time.Now().Unix(), Metrics: &readmodel.MarketMetricsReadModel{Status: "available"}}
	got, err := s.advance(context.Background(), v, h, 12)
	if err != nil || got.Cursor != 12 || rpc.calls != 0 {
		t.Fatalf("empty range: %+v %v calls=%d", got, err, rpc.calls)
	}
	_, err = s.advance(context.Background(), got, h, 12)
	if err != nil || rpc.logCalls != 1 {
		t.Fatal("re-read unchanged head")
	}
	h.Number = "0xe"
	_, err = s.advance(context.Background(), got, h, 14)
	if err != nil || rpc.ranges[1] != [2]uint64{13, 14} {
		t.Fatal("overlapping range", rpc.ranges, err)
	}
}
func TestHTTPQueuesButNeverCallsRPC(t *testing.T) {
	rpc := &rpcFixture{}
	s := Service{RPC: rpc, states: map[string]State{}, pending: map[string]bool{}, rejected: map[string]time.Time{}, wake: make(chan struct{}, 1)}
	id := "0x" + strings.Repeat("b", 64)
	r := httptest.NewRequest("GET", "/v1/market-statistics?markets="+id, nil)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 200 || rpc.calls != 0 || rpc.logCalls != 0 || !s.pending[id] {
		t.Fatal("request did synchronous work", w.Code)
	}
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/v1/market-statistics?markets=bad", nil))
	if w.Code != 400 {
		t.Fatal("invalid market accepted")
	}
}
func TestCurveBuyUpdatesLastBuyButDefersMarketCap(t *testing.T) {
	hash := "0x" + strings.Repeat("a", 64)
	curve := "0x" + strings.Repeat("c", 40)
	topicAddr := "0x" + strings.Repeat("0", 24) + strings.Repeat("b", 40)
	data := "0x"
	for _, n := range []int64{10, 100, 1, 0} {
		data += fmt.Sprintf("%064x", n)
	}
	rpc := &rpcFixture{logs: []chainrpc.Log{{Address: curve, BlockNumber: "0xb", BlockHash: hash, TransactionIndex: "0x2", LogIndex: "0x3", Topics: []string{deployment.Hash([]byte("CurveBuy(address,address,uint256,uint256,uint256,uint256)")), topicAddr, topicAddr}, Data: data}}}
	cap := "123"
	s := Service{RPC: rpc}
	h := chainrpc.Header{Number: "0xc", Timestamp: "0x1", Hash: hash}
	v := State{Curve: curve, Phase: "0", Cursor: 10, Hash: hash, StatsAt: time.Now().Unix(), Decimals: 18, Metrics: &readmodel.MarketMetricsReadModel{Status: "available", MarketCapUSD: &cap}}
	got, err := s.advance(context.Background(), v, h, 12)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastBuy == nil || got.LastBuy.BlockNumber != "11" || got.LastBuy.TransactionIndex != "2" || got.LastBuy.LogIndex != "3" {
		t.Fatal("buy not ordered", got.LastBuy)
	}
	if *got.Metrics.MarketCapUSD != "123" || rpc.calls != 2 {
		t.Fatal("statistics timing or dirty coalescing")
	}
}
