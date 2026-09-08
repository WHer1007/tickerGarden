package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"tickergarden/backend/internal/displayprice"
	"tickergarden/backend/internal/readmodel"
)

func metricValue(value string) *string { return &value }

func TestMarketUSDSortsDescendingAndUnavailableLast(t *testing.T) {
	s := marketQuerySnapshot(t)
	s.Markets = s.Markets[:4]
	s.Markets[0].Metrics = &readmodel.MarketMetricsReadModel{Volume24hUSD: metricValue("2"), MarketCapUSD: metricValue("100")}
	s.Markets[1].Metrics = &readmodel.MarketMetricsReadModel{Volume24hUSD: metricValue("10.5"), MarketCapUSD: metricValue("9")}
	s.Markets[2].Metrics = &readmodel.MarketMetricsReadModel{Volume24hUSD: metricValue("10.05"), MarketCapUSD: nil}
	s.Markets[3].Metrics = nil

	for _, tc := range []struct {
		sort string
		want []string
	}{
		{"volume24hUsd_desc", []string{s.Markets[1].MarketID, s.Markets[2].MarketID, s.Markets[0].MarketID, s.Markets[3].MarketID}},
		{"marketCapUsd_desc", []string{s.Markets[0].MarketID, s.Markets[1].MarketID, s.Markets[2].MarketID, s.Markets[3].MarketID}},
	} {
		items, filter, key, err := queryMarkets(s.Markets, url.Values{"sort": {tc.sort}})
		if err != nil {
			t.Fatal(err)
		}
		page, err := paginate(items, url.Values{"limit": {"100"}}, "markets", filter, s.Sync, key)
		if err != nil || len(page.Items) != len(tc.want) {
			t.Fatal(err)
		}
		for i, want := range tc.want {
			if page.Items[i].MarketID != want {
				t.Fatalf("%s item %d: got %s want %s", tc.sort, i, page.Items[i].MarketID, want)
			}
		}
	}
}

type fixtureMarketMetrics struct{}

func (fixtureMarketMetrics) MarketMetrics(_ context.Context, snap readmodel.Snapshot, _ []displayprice.Reference) (map[string]*readmodel.MarketMetricsReadModel, error) {
	out := make(map[string]*readmodel.MarketMetricsReadModel, len(snap.Markets))
	for i, market := range snap.Markets {
		value := metricValue(string(rune('1' + i%9)))
		out[market.MarketID] = &readmodel.MarketMetricsReadModel{Status: "available", Reason: "", Volume24hUSD: value, MarketCapUSD: value, QuoteUSDMidpoint: metricValue("1"), WindowFromTimestamp: "1", AsOfTimestamp: "86401", USDPriceAsOf: metricValue("2026-09-08T00:00:00Z"), USDPriceSource: metricValue("robinhood_rest"), VolumeBasis: "EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE", MarketCapBasis: "BASELINE_TOTAL_SUPPLY_X_LATEST_FINALIZED_24H_EXECUTION_PRICE"}
	}
	return out, nil
}

func TestMarketMetricSortEndpointReturnsContractValidMetrics(t *testing.T) {
	s := marketQuerySnapshot(t)
	h := New(Options{ChainID: 46630, ReadModels: fixtureReader{s}, MarketMetrics: fixtureMarketMetrics{}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/markets?sort=volume24hUsd_desc&limit=3", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if err := readmodel.ValidateResponse("MarketPage", w.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
}
