package tokendetail

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDuneEnsureRefreshIsOnDemandAndCoalesced(t *testing.T) {
	d, _ := NewDune("42", "secret")
	var calls atomic.Int32
	d.Client = &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		body := duneEnvelope("42", "QUERY_STATE_COMPLETED", "exec", `{"version":1,"chainId":4663,"displayOnly":true,"marketId":"0x1111111111111111111111111111111111111111111111111111111111111111","memeToken":"0x1111111111111111111111111111111111111111","quoteAsset":"0x2222222222222222222222222222222222222222","quoteDecimals":6,"period":"1H","sources":{},"reasons":{}}`, nil, 1)
		return &http.Response{StatusCode: 200, Body: ioNopCloser{strings.NewReader(body)}, Header: make(http.Header)}, nil
	})}
	if calls.Load() != 0 {
		t.Fatal("provider called before demand")
	}
	for i := 0; i < 8; i++ {
		go func() { _ = d.EnsureRefresh(context.Background(), testChain) }()
	}
	deadline := time.Now().Add(time.Second)
	for calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls=%d, want one coalesced fetch", calls.Load())
	}
	_ = d.EnsureRefresh(context.Background(), testChain)
	time.Sleep(10 * time.Millisecond)
	if calls.Load() != 1 {
		t.Fatalf("cache reuse made %d calls", calls.Load())
	}
}

func TestDuneEnsureRefreshDoesNotBlockValidCache(t *testing.T) {
	d, _ := NewDune("42", "secret")
	var old Report
	_ = json.Unmarshal([]byte(`{"version":1,"chainId":4663,"displayOnly":true,"marketId":"0x1111111111111111111111111111111111111111111111111111111111111111","memeToken":"0x1111111111111111111111111111111111111111","quoteAsset":"0x2222222222222222222222222222222222222222","quoteDecimals":6,"period":"1H","sources":{},"reasons":{}}`), &old)
	now := uint64(time.Now().Unix())
	old.Statistics = &Statistics{VolumeFrom: now - 86400, VolumeTo: now, VolumeBasis: VolumeBasis}
	old.Sources = map[string]Source{"statistics": {AsOf: now, BlockNumber: "1", BlockHash: "0x" + strings.Repeat("1", 64)}}
	d.reports = map[string]Report{old.MarketID + ":1H": old}
	started := make(chan struct{})
	release := make(chan struct{})
	d.Client = &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
		close(started)
		<-release
		return nil, context.Canceled
	})}
	begin := time.Now()
	if err := d.EnsureRefresh(context.Background(), testChain); err != nil || time.Since(begin) > 100*time.Millisecond {
		t.Fatalf("EnsureRefresh blocked: %v", err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("refresh did not start")
	}
	if _, ok := d.Get(testChain, old.MarketID, old.Period, time.Now()); !ok {
		t.Fatal("valid cached report unavailable while refresh was slow")
	}
	close(release)
}

func TestDuneFailedRefreshPreservesThenExpiresCache(t *testing.T) {
	d, _ := NewDune("42", "secret")
	var old Report
	_ = json.Unmarshal([]byte(`{"version":1,"chainId":4663,"displayOnly":true,"marketId":"0x1111111111111111111111111111111111111111111111111111111111111111","memeToken":"0x1111111111111111111111111111111111111111","quoteAsset":"0x2222222222222222222222222222222222222222","quoteDecimals":6,"period":"1H","sources":{},"reasons":{}}`), &old)
	d.reports = map[string]Report{old.MarketID + ":1H": old}
	d.Client = &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 500, Body: ioNopCloser{strings.NewReader("fail")}, Header: make(http.Header)}, nil
	})}
	_ = d.EnsureRefresh(context.Background(), testChain)
	time.Sleep(20 * time.Millisecond)
	if _, ok := d.Get(testChain, old.MarketID, old.Period, time.Now()); !ok {
		t.Fatal("failed refresh discarded cache")
	}
	old.Sources["statistics"] = Source{AsOf: uint64(time.Now().Add(-21 * time.Minute).Unix()), BlockNumber: "1", BlockHash: "0x" + strings.Repeat("1", 64), CachedAt: uint64(time.Now().Add(-21 * time.Minute).Unix())}
	d.reports[old.MarketID+":1H"] = old
	if _, ok := d.Get(testChain, old.MarketID, old.Period, time.Now()); ok {
		t.Fatal("expired source remained available")
	}
}
