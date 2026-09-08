package tokendetail

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/analytics"
	"tickergarden/backend/internal/readmodel"
)

const testChain uint64 = 4663

func baseReport(now time.Time) Report {
	return Report{Version: Version, ChainID: testChain, DisplayOnly: true,
		MarketID:  "0x1111111111111111111111111111111111111111111111111111111111111111",
		MemeToken: "0x1111111111111111111111111111111111111111", QuoteAsset: "0x2222222222222222222222222222222222222222",
		QuoteDecimals: 6, Period: "1H", Sources: map[string]Source{}, Reasons: map[string]string{}}
}

func TestValidateRejectsIdentityFreshnessAndPartialData(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	bad := baseReport(now)
	bad.ChainID = 1
	if Validate(bad, testChain, now) == nil {
		t.Fatal("wrong chain accepted")
	}
	bad = baseReport(now)
	bad.MemeToken = bad.QuoteAsset
	if Validate(bad, testChain, now) == nil {
		t.Fatal("same asset identity accepted")
	}
	bad = baseReport(now)
	bad.Statistics = &Statistics{VolumeBasis: VolumeBasis, VolumeFrom: 0, VolumeTo: 86400}
	bad.Sources["statistics"] = Source{AsOf: uint64(now.Unix()), BlockNumber: "1", BlockHash: "0x" + strings.Repeat("a", 64)}
	if Validate(bad, testChain, now) == nil {
		t.Fatal("stale/incomplete statistics window accepted")
	}
	bad = baseReport(now)
	bad.Period = "2H"
	if Validate(bad, testChain, now) == nil {
		t.Fatal("invalid period accepted")
	}
	bad = baseReport(now)
	bad.Chart = &Chart{From: 0, To: 3600, Interval: 60, Points: []Point{}}
	bad.Sources["chart"] = Source{AsOf: uint64(now.Unix()), BlockNumber: "1", BlockHash: "0x" + strings.Repeat("a", 64)}
	if Validate(bad, testChain, now) == nil {
		t.Fatal("incomplete chart accepted")
	}
}

func TestDuneStatisticsCadenceAndFreshnessWindow(t *testing.T) {
	if dunePollInterval != 10*time.Minute {
		t.Fatalf("statistics poll interval = %s, want 10m", dunePollInterval)
	}
	// The worker cadence is independent from the existing 20-minute report age
	// guard, so one missed poll still leaves the report within its freshness SLA.
	if 2*dunePollInterval > 20*time.Minute {
		t.Fatal("statistics cadence exceeds the 20-minute freshness window")
	}
}

func TestValidateRejectsSupplyDuplicateTradesAndAllowsZeroVolume(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	src := Source{AsOf: uint64(now.Unix()), BlockNumber: "1", BlockHash: "0x" + strings.Repeat("a", 64)}
	r := baseReport(now)
	r.Statistics = &Statistics{Volume24h: str("0"), VolumeFrom: uint64(now.Unix() - 86400), VolumeTo: uint64(now.Unix()), VolumeBasis: VolumeBasis}
	r.Sources["statistics"] = src
	if err := Validate(r, testChain, now); err != nil {
		t.Fatalf("zero volume should be valid: %v", err)
	}
	r = baseReport(now)
	r.Holders = &Holders{TotalSupplyRaw: "10", CirculatingSupplyRaw: "5", Count: 2, Basis: SupplyBasis, Items: []Holder{{Account: "0x3333333333333333333333333333333333333333", BalanceRaw: "3"}, {Account: "0x3333333333333333333333333333333333333333", BalanceRaw: "2"}}}
	r.Sources["holders"] = src
	if Validate(r, testChain, now) == nil {
		t.Fatal("duplicate holder accepted")
	}
	r = baseReport(now)
	r.Holders = &Holders{TotalSupplyRaw: "10", CirculatingSupplyRaw: "11", Basis: SupplyBasis}
	r.Sources["holders"] = src
	if Validate(r, testChain, now) == nil {
		t.Fatal("circulating supply above total accepted")
	}
	r = baseReport(now)
	tr := Trade{Timestamp: uint64(now.Unix()), Side: "buy", Price: "1", MemeRaw: "1", QuoteRaw: "1", TxHash: "0x" + strings.Repeat("b", 64), EventKey: "e", Classification: "unclassified"}
	r.Trades = []Trade{tr, tr}
	r.Sources["trades"] = src
	if Validate(r, testChain, now) == nil {
		t.Fatal("duplicate trade accepted")
	}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func duneEnvelope(qid, state, exec, payload string, next *string, count int) string {
	n := "null"
	if next != nil {
		n = fmt.Sprintf("%q", *next)
	}
	return fmt.Sprintf(`{"query_id":%s,"execution_id":%q,"state":%q,"execution_ended_at":%q,"next_uri":%s,"result":{"metadata":{"total_row_count":%d},"rows":[{"payload":%q}]}}`, qid, exec, state, time.Now().UTC().Format(time.RFC3339), n, count, payload)
}

func TestDuneRefreshValidatesEnvelopeAndPreservesCacheOnFailure(t *testing.T) {
	d, _ := NewDune("42", "secret")
	payload := `{"version":1,"chainId":4663,"displayOnly":true,"marketId":"0x1111111111111111111111111111111111111111111111111111111111111111","memeToken":"0x1111111111111111111111111111111111111111","quoteAsset":"0x2222222222222222222222222222222222222222","quoteDecimals":6,"period":"1H","sources":{},"reasons":{}}`
	seen := false
	d.Client = &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		seen = r.Header.Get("X-Dune-API-Key") == "secret"
		b := duneEnvelope("42", "QUERY_STATE_COMPLETED", "exec", payload, nil, 1)
		return &http.Response{StatusCode: 200, Body: ioNopCloser{strings.NewReader(b)}, Header: make(http.Header)}, nil
	})}
	if err := d.Refresh(context.Background(), testChain); err != nil || !seen {
		t.Fatalf("valid refresh failed: %v key=%v", err, seen)
	}
	if _, ok := d.Get(testChain, "0x1111111111111111111111111111111111111111111111111111111111111111", "1H", time.Now()); !ok {
		t.Fatal("valid cache unavailable")
	}
	next := "/next"
	d.Client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		b := duneEnvelope("42", "QUERY_STATE_COMPLETED", "exec", payload, &next, 1)
		return &http.Response{StatusCode: 200, Body: ioNopCloser{strings.NewReader(b)}, Header: make(http.Header)}, nil
	})
	if d.Refresh(context.Background(), testChain) == nil {
		t.Fatal("truncated result accepted")
	}
	if _, ok := d.Get(testChain, "0x1111111111111111111111111111111111111111111111111111111111111111", "1H", time.Now()); !ok {
		t.Fatal("failed refresh discarded valid cache")
	}
}

func TestDuneRefreshRejectsEnvelopeBoundaries(t *testing.T) {
	d, _ := NewDune("42", "secret")
	payload := `{"version":1,"chainId":4663,"displayOnly":true,"marketId":"0x1111111111111111111111111111111111111111111111111111111111111111","memeToken":"0x1111111111111111111111111111111111111111","quoteAsset":"0x2222222222222222222222222222222222222222","quoteDecimals":6,"period":"1H","sources":{},"reasons":{}}`
	cases := []struct{ name, body string }{
		{"wrong query", duneEnvelope("41", "QUERY_STATE_COMPLETED", "e", payload, nil, 1)},
		{"failed state", duneEnvelope("42", "QUERY_STATE_FAILED", "e", payload, nil, 1)},
		{"row count", duneEnvelope("42", "QUERY_STATE_COMPLETED", "e", payload, nil, 2)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d.Client = &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: ioNopCloser{strings.NewReader(tc.body)}, Header: make(http.Header)}, nil
			})}
			if d.Refresh(context.Background(), testChain) == nil {
				t.Fatal("invalid envelope accepted")
			}
		})
	}
	old := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	oldBody := strings.Replace(duneEnvelope("42", "QUERY_STATE_COMPLETED", "e", payload, nil, 1), time.Now().UTC().Format(time.RFC3339), old, 1)
	d.Client = &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: ioNopCloser{strings.NewReader(oldBody)}, Header: make(http.Header)}, nil
	})}
	if d.Refresh(context.Background(), testChain) == nil {
		t.Fatal("old execution accepted")
	}
}

type ioNopCloser struct{ *strings.Reader }

func (ioNopCloser) Close() error { return nil }

type stubReader struct{ snap readmodel.Snapshot }

func (s stubReader) Load(context.Context, string) (readmodel.Snapshot, error) { return s.snap, nil }

type countingHistory struct {
	calls    int
	now      uint64
	identity Report
}

func (h *countingHistory) coverage(from, to uint64) analytics.RangeCoverage {
	return analytics.RangeCoverage{From: from, To: to, ProjectionNumber: 100, ProjectionHash: "0x" + strings.Repeat("4", 64)}
}
func (h *countingHistory) Candles(_ context.Context, _ string, from, to, interval uint64) (analytics.MarketCandles, error) {
	h.calls++
	points := []analytics.Candle{}
	for ts := from; ts < to; ts += interval {
		points = append(points, analytics.Candle{Timestamp: ts, QuoteVolumeRaw: "0", InternalQuoteVolumeRaw: "0"})
	}
	return analytics.MarketCandles{MemeAsset: h.identity.MemeToken, QuoteAsset: h.identity.QuoteAsset, QuoteDecimals: h.identity.QuoteDecimals, Coverage: h.coverage(from, to), Series: analytics.CandleSeries{Candles: points}}, nil
}
func (h *countingHistory) Trades(_ context.Context, _ string, from, to uint64, _ int, _ string) (analytics.TradePage, error) {
	h.calls++
	return analytics.TradePage{MemeAsset: h.identity.MemeToken, QuoteAsset: h.identity.QuoteAsset, Coverage: h.coverage(from, to), Items: []analytics.TradeActivity{}}, nil
}
func (h *countingHistory) Holders(context.Context, string) (analytics.MarketHolders, error) {
	h.calls++
	return analytics.MarketHolders{MemeToken: h.identity.MemeToken, Finality: "finalized", SourceBlockNumber: "100", SourceBlockHash: "0x" + strings.Repeat("4", 64), HolderBalances: analytics.HolderBalances{TotalSupplyRaw: "100", Balances: []analytics.HolderBalance{{Account: "0x" + strings.Repeat("5", 40), BalanceRaw: "40"}, {Account: "0x" + strings.Repeat("6", 40), BalanceRaw: "60", Excluded: true}}}}, nil
}
func (h *countingHistory) DetailTip(context.Context) (uint64, string, string, error) {
	h.calls++
	return h.now, "100", "0x" + strings.Repeat("4", 64), nil
}
func (h *countingHistory) DetailFees(_ context.Context, _ string, from, to uint64) (analytics.DetailFeesResult, error) {
	h.calls++
	return analytics.DetailFeesResult{Fees: []analytics.DetailFee{}, Coverage: h.coverage(from, to)}, nil
}
func (h *countingHistory) DetailBlock(context.Context, string, string) (uint64, error) {
	h.calls++
	return h.now, nil
}
func serviceFixture(t *testing.T) (*Service, *countingHistory, Report) {
	t.Helper()
	now := uint64(time.Now().Unix() / 60 * 60)
	r := baseReport(time.Now())
	src := Source{Provider: "dune", AsOf: now, BlockNumber: "100", BlockHash: "0x" + strings.Repeat("4", 64)}
	r.Statistics = &Statistics{Price: str("1"), Volume24h: str("5"), VolumeFrom: now - 86400, VolumeTo: now, VolumeBasis: VolumeBasis}
	r.Chart = &Chart{From: now - 3600, To: now, Interval: 60, Points: []Point{}}
	for ts := now - 3600; ts < now; ts += 60 {
		r.Chart.Points = append(r.Chart.Points, Point{Timestamp: ts})
	}
	r.Trades = []Trade{}
	r.Holders = &Holders{TotalSupplyRaw: "100", CirculatingSupplyRaw: "40", Count: 1, Basis: SupplyBasis, Items: []Holder{{Account: "0x" + strings.Repeat("5", 40), BalanceRaw: "40"}}}
	r.Fees = []Fee{}
	for _, k := range []string{"statistics", "chart", "trades", "holders", "fees"} {
		r.Sources[k] = src
	}
	if Validate(r, testChain, time.Now()) != nil {
		t.Fatal("invalid complete fixture")
	}
	h := &countingHistory{now: now, identity: r}
	market := readmodel.MarketReadModel{MarketID: r.MarketID, MemeToken: r.MemeToken, QuoteAsset: r.QuoteAsset, QuoteAssetConfigID: r.MarketID, Identity: &readmodel.MarketIdentityReadModel{DeployedAt: fmt.Sprint(now - 86400)}}
	snap := readmodel.Snapshot{Sync: readmodel.SyncStatus{ChainID: testChain, Status: "synced", Finality: "finalized", Revision: "fixture"}, Markets: []readmodel.MarketReadModel{market}, Configs: []readmodel.ConfigReadModel{{Kind: "quote", ID: r.MarketID, Values: map[string]any{"quoteDecimals": r.QuoteDecimals}}}}
	return &Service{ChainID: testChain, Models: stubReader{snap}, History: h}, h, r
}
func TestServicePrefersDuneWithoutComputingAndCachesFallback(t *testing.T) {
	s, h, r := serviceFixture(t)
	s.Dune = &Dune{reports: map[string]Report{r.MarketID + ":" + r.Period: r}}
	got, e := s.Detail(context.Background(), r.MarketID, r.Period)
	if e != nil || got.Statistics == nil || *got.Statistics.Price != "1" || h.calls != 0 {
		t.Fatal("complete Dune must avoid indexing", e, h.calls)
	}
	s, h, r = serviceFixture(t)
	r.Chart = nil
	r.Holders = nil
	r.Trades = nil
	r.Fees = nil
	for _, k := range []string{"chart", "holders", "trades", "fees"} {
		delete(r.Sources, k)
	}
	s.Dune = &Dune{reports: map[string]Report{r.MarketID + ":" + r.Period: r}}
	got, e = s.Detail(context.Background(), r.MarketID, r.Period)
	if e != nil || got.Statistics == nil || *got.Statistics.Price != "1" || got.Holders == nil || got.Holders.CirculatingSupplyRaw != "40" || got.Sources["statistics"].Provider != "dune" || got.Sources["holders"].Provider != "indexer" {
		t.Fatalf("section fallback mismatch %+v %v", got, e)
	}
	calls := h.calls
	if calls == 0 {
		t.Fatal("fallback not reached")
	}
	_, e = s.Detail(context.Background(), r.MarketID, r.Period)
	if e != nil || h.calls != calls {
		t.Fatal("cache repeated expensive reads")
	}
}
func TestServiceNilDuneAndWrongTokenUseFinalizedFallback(t *testing.T) {
	for _, kind := range []string{"nil", "wrong-token", "stale"} {
		t.Run(kind, func(t *testing.T) {
			s, _, r := serviceFixture(t)
			if kind == "wrong-token" {
				r.MemeToken = "0x" + strings.Repeat("7", 40)
			}
			if kind == "stale" {
				src := r.Sources["statistics"]
				src.AsOf -= 3600
				r.Sources["statistics"] = src
			}
			if kind != "nil" {
				s.Dune = &Dune{reports: map[string]Report{r.MarketID + ":" + r.Period: r}}
			}
			got, e := s.Detail(context.Background(), r.MarketID, r.Period)
			if e != nil || got.Statistics == nil || got.Statistics.Price != nil || got.Holders == nil || got.Holders.CirculatingSupplyRaw != "40" || got.Sources["statistics"].Provider != "indexer" {
				t.Fatalf("fallback failed %+v %v", got, e)
			}
		})
	}
}
