package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"tickergarden/backend/internal/analytics"
)

// Controlled reader data for the full stats page; no RPC or database evidence.
type browserStatisticsReader struct{ *browserDirectoryReader }

func (b *browserStatisticsReader) coverage(from, to uint64) analytics.RangeCoverage {
	return analytics.RangeCoverage{From: from, To: to, AnchorNumber: 1, AnchorHash: fmt.Sprintf("0x%064x", 1), ThroughNumber: 2, ThroughHash: fmt.Sprintf("0x%064x", 2), ProjectionNumber: 3, ProjectionHash: fmt.Sprintf("0x%064x", 3)}
}
func (b *browserStatisticsReader) GlobalStatistics(_ context.Context, from, to uint64) (analytics.GlobalStatistics, error) {
	if b.unavailable.Load() {
		return analytics.GlobalStatistics{}, analytics.ErrCoverage
	}
	return analytics.GlobalStatistics{Coverage: b.coverage(from, to), MarketCount: 130, UnboundMarketCount: 130, Stocks: []analytics.StockIdentity{}, Groups: []analytics.GlobalTradeGroup{{Binding: "unbound", AssetTradeStats: analytics.AssetTradeStats{
		AssetUID: "0x" + strings.Repeat("0", 64), QuoteAsset: "0x" + strings.Repeat("0", 40), QuoteDecimals: 18, MarketCount: 130, TradingMarketCount: 1, TradeCount: 2, InternalTradeCount: 1, UnclassifiedTradeCount: 1, QuoteVolumeRaw: "3000000000000000000", InternalQuoteVolumeRaw: "1000000000000000000", Fees: []analytics.AssetFeeTotal{}, UnknownFeeTradeCount: 2, VolumeBasis: "CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE",
	}}}}, nil
}
func (b *browserStatisticsReader) GlobalHolders(context.Context) (analytics.GlobalHolderCounts, error) {
	if b.unavailable.Load() {
		return analytics.GlobalHolderCounts{}, analytics.ErrCoverage
	}
	return analytics.GlobalHolderCounts{SourceBlockNumber: "3", SourceBlockHash: fmt.Sprintf("0x%064x", 3), MarketCount: 130, PositiveMarketAddressPairs: 260, PositiveAddressCount: 3, IncludedAddressCount: 2, ExclusionPolicy: "UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1", ExcludedAccounts: []string{fmt.Sprintf("0x%040x", 1)}, Groups: []analytics.AssetHolderCounts{{AssetUID: "0x" + strings.Repeat("0", 64), Binding: "unbound", MarketCount: 130, PositiveMarketAddressPairs: 260, PositiveAddressCount: 3, IncludedAddressCount: 2}}}, nil
}
func (b *browserStatisticsReader) GlobalSeries(ctx context.Context, from, to, interval uint64) (analytics.GlobalFlowSeries, error) {
	stats, err := b.GlobalStatistics(ctx, from, to)
	if err != nil {
		return analytics.GlobalFlowSeries{}, err
	}
	out := analytics.GlobalFlowSeries{Coverage: stats.Coverage, Interval: interval, VolumeBasis: "CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE", EmptyPolicy: "ZERO_FLOW_NO_SYNTHETIC_EXECUTIONS", Points: []analytics.GlobalFlowPoint{}}
	for ts := from; ts < to; ts += interval {
		group := analytics.GlobalFlowGroup{AssetUID: stats.Groups[0].AssetUID, Binding: "unbound", QuoteAsset: stats.Groups[0].QuoteAsset, QuoteDecimals: 18, QuoteVolumeRaw: "0", InternalQuoteVolumeRaw: "0", Fees: []analytics.AssetFeeTotal{}}
		if ts == from {
			group.TradeCount = 2
			group.InternalTradeCount = 1
			group.UnclassifiedTradeCount = 1
			group.UnknownFeeTradeCount = 2
			group.QuoteVolumeRaw = "3000000000000000000"
			group.InternalQuoteVolumeRaw = "1000000000000000000"
		}
		out.Points = append(out.Points, analytics.GlobalFlowPoint{Timestamp: ts, Groups: []analytics.GlobalFlowGroup{group}})
	}
	return out, nil
}

func TestStatisticsBrowserFixture(t *testing.T) {
	target := os.Getenv("TG_TEST_STATS_BROWSER_URL_FILE")
	if target == "" {
		t.Skip("set TG_TEST_STATS_BROWSER_URL_FILE")
	}
	snapshot := identityMarketSnapshot(t)
	snapshot.Sync.ChainID = 4663
	snapshot.Sync.Revision = *snapshot.Sync.BlockNumber + ":" + *snapshot.Sync.BlockHash
	for i := range snapshot.Markets {
		snapshot.Markets[i].QuoteAsset = "0x" + strings.Repeat("0", 40)
	}
	reader := &browserStatisticsReader{&browserDirectoryReader{snapshot: snapshot}}
	api := New(Options{ChainID: 4663, ReadModels: reader, GlobalStatistics: reader, GlobalHolders: reader, GlobalSeries: reader, AllowedOrigin: "http://127.0.0.1:4395"})
	stop := make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/__fixture/") {
			if r.Method != http.MethodPost {
				w.WriteHeader(405)
				return
			}
			switch r.URL.Path {
			case "/__fixture/stop":
				once.Do(func() { close(stop) })
			case "/__fixture/unavailable":
				reader.unavailable.Store(true)
			case "/__fixture/recover":
				reader.unavailable.Store(false)
			default:
				w.WriteHeader(404)
				return
			}
			w.WriteHeader(204)
			return
		}
		api.ServeHTTP(w, r)
	}))
	defer server.Close()
	if err := os.WriteFile(target, []byte(server.URL), 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(target)
	select {
	case <-stop:
	case <-time.After(300 * time.Second):
		t.Fatal("statistics browser fixture timed out")
	}
}
