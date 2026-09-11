package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tickergarden/backend/internal/displayprice"
	"tickergarden/backend/internal/marketstats"
	"tickergarden/backend/internal/readmodel"
)

func marketQuerySnapshot(t *testing.T) readmodel.Snapshot {
	t.Helper()
	s := testSnapshot(t)
	base := s.Markets[0]
	s.Markets = make([]readmodel.MarketReadModel, 0, 130)
	for i := 0; i < 130; i++ {
		m := base
		m.MarketID = fmt.Sprintf("0x%064x", i+1)
		m.AssetUID = fmt.Sprintf("0x%064x", (i%4)+1)
		m.MemeToken = fmt.Sprintf("0x%040x", (i%3)+1)
		m.LaunchPhase = uint64(i % 2)
		s.Markets = append(s.Markets, m)
	}
	s.Sync.Revision = "7:0x" + strings.Repeat("c", 64)
	return s
}

func marketQueryHandler(s readmodel.Snapshot) http.Handler {
	return New(Options{ChainID: 46630, ReadModels: fixtureReader{s}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
}

func marketPage(t *testing.T, h http.Handler, path string, code int) page[readmodel.MarketReadModel] {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	if w.Code != code {
		t.Fatalf("%s: got %d, body %s", path, w.Code, w.Body.String())
	}
	var p page[readmodel.MarketReadModel]
	if code == http.StatusOK && json.Unmarshal(w.Body.Bytes(), &p) != nil {
		t.Fatal("invalid market page JSON")
	}
	return p
}

func TestMarketQueryFiltersBeforePagination(t *testing.T) {
	s := marketQuerySnapshot(t)
	h := marketQueryHandler(s)
	p := marketPage(t, h, "/v1/markets?limit=1&assetUid=0x0000000000000000000000000000000000000000000000000000000000000001", 200)
	if len(p.Items) != 1 || p.Items[0].MarketID != fmt.Sprintf("0x%064x", 1) {
		t.Fatalf("filter was applied after pagination: %+v", p.Items)
	}
	p = marketPage(t, h, "/v1/markets?limit=1&marketId="+s.Markets[129].MarketID, 200)
	if len(p.Items) != 1 || p.Items[0].MarketID != s.Markets[129].MarketID {
		t.Fatal("late market missing from full directory")
	}
	p = marketPage(t, h, "/v1/markets?limit=1&marketId=0x"+strings.ToUpper(s.Markets[126].MarketID[2:]), 200)
	if len(p.Items) != 1 || p.Items[0].MarketID != s.Markets[126].MarketID {
		t.Fatal("market ID normalization failed")
	}
	// Every predicate is an exact AND filter.
	p = marketPage(t, h, "/v1/markets?limit=100&assetUid=0x"+strings.Repeat("0", 63)+"1&memeToken=0x"+strings.Repeat("0", 39)+"1&launchPhase=0", 200)
	if len(p.Items) != 11 {
		t.Fatal("AND query unexpectedly empty or incomplete", len(p.Items))
	}
	for _, m := range p.Items {
		if m.AssetUID != "0x"+strings.Repeat("0", 63)+"1" || m.MemeToken != "0x"+strings.Repeat("0", 39)+"1" || m.LaunchPhase != 0 {
			t.Fatalf("AND filter leaked %+v", m)
		}
	}
}

func TestMarketQueryPagingOrderAndCursorBinding(t *testing.T) {
	s := marketQuerySnapshot(t)
	h := marketQueryHandler(s)
	for _, sort := range []string{"marketId_asc", "marketId_desc"} {
		path := "/v1/markets?limit=17&sort=" + sort
		seen := map[string]bool{}
		var cursor, previous string
		for {
			if cursor != "" {
				path = "/v1/markets?limit=17&sort=" + sort + "&cursor=" + cursor
			}
			p := marketPage(t, h, path, 200)
			for _, m := range p.Items {
				if previous != "" && ((sort == "marketId_asc" && m.MarketID <= previous) || (sort == "marketId_desc" && m.MarketID >= previous)) {
					t.Fatal("incorrect page ordering")
				}
				previous = m.MarketID
				if seen[m.MarketID] {
					t.Fatalf("duplicate %s", m.MarketID)
				}
				seen[m.MarketID] = true
			}
			if p.NextCursor == nil {
				break
			}
			cursor = *p.NextCursor
		}
		if len(seen) != 130 {
			t.Fatalf("%s returned %d markets", sort, len(seen))
		}
	}
	first := marketPage(t, h, "/v1/markets?limit=2&sort=marketId_asc", 200)
	c := *first.NextCursor
	for _, path := range []string{"/v1/markets?limit=2&sort=marketId_desc&cursor=" + c, "/v1/markets?limit=2&assetUid=0x" + strings.Repeat("0", 63) + "1&cursor=" + c} {
		marketPage(t, h, path, 400)
	}
	hRevision := New(Options{ChainID: 46630, ReadModels: readerFunc(func(_ context.Context, revision string) (readmodel.Snapshot, error) {
		if revision != "" && revision != s.Sync.Revision {
			return readmodel.Snapshot{}, readmodel.ErrRevision
		}
		return s, nil
	}), Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	marketPage(t, hRevision, "/v1/markets?limit=2&sort=marketId_asc&revision=8:0x"+strings.Repeat("d", 64)+"&cursor="+c, 400)
}

func TestMarketQueryRejectsInvalidDuplicateAndUnknownQueries(t *testing.T) {
	h := marketQueryHandler(marketQuerySnapshot(t))
	for _, path := range []string{"/v1/markets?limit=0", "/v1/markets?limit=101", "/v1/markets?limit=1&limit=2", "/v1/markets?foo=bar", "/v1/markets?sort=nope", "/v1/markets?launchPhase=2", "/v1/markets?marketId=bad", "/v1/markets?memeToken=bad", "/v1/markets?assetUid=bad", "/v1/markets?cursor=garbage"} {
		marketPage(t, h, path, 400)
	}
}

func TestMarketQueryRecentBuyNumericOrderAndCursorBinding(t *testing.T) {
	s := marketQuerySnapshot(t)
	s.Markets = s.Markets[:6]
	// Deliberately use values whose numeric and lexical orders differ.
	s.Markets[0].LastBuy = &readmodel.LastBuyReadModel{BlockNumber: "10", TransactionIndex: "1", LogIndex: "2", Timestamp: "100"}
	s.Markets[1].LastBuy = &readmodel.LastBuyReadModel{BlockNumber: "2", TransactionIndex: "99", LogIndex: "99", Timestamp: "99"}
	s.Markets[2].LastBuy = &readmodel.LastBuyReadModel{BlockNumber: "10", TransactionIndex: "2", LogIndex: "1", Timestamp: "101"}
	s.Markets[3].LastBuy = &readmodel.LastBuyReadModel{BlockNumber: "10", TransactionIndex: "2", LogIndex: "1", Timestamp: "101"}
	s.Markets[4].LastBuy = &readmodel.LastBuyReadModel{BlockNumber: "10", TransactionIndex: "2", LogIndex: "0", Timestamp: "102"}
	s.Markets[5].LastBuy = nil
	h := marketQueryHandler(s)
	want := []string{s.Markets[2].MarketID, s.Markets[3].MarketID, s.Markets[4].MarketID, s.Markets[0].MarketID, s.Markets[1].MarketID, s.Markets[5].MarketID}
	var got []string
	var cursor string
	for {
		path := "/v1/markets?limit=2&sort=recentBuy_desc"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		page := marketPage(t, h, path, 200)
		for _, m := range page.Items {
			got = append(got, m.MarketID)
		}
		if page.NextCursor == nil {
			break
		}
		cursor = *page.NextCursor
	}
	if len(got) != len(want) {
		t.Fatalf("got %d items, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("position %d: got %s want %s", i, got[i], want[i])
		}
	}
	// Reusing the cursor with a different sort is rejected because the cursor
	// remains bound to the original ranking definition.
	first := marketPage(t, h, "/v1/markets?limit=2&sort=recentBuy_desc", 200)
	marketPage(t, h, "/v1/markets?limit=2&sort=marketId_asc&cursor="+*first.NextCursor, 400)
}

type changingMarketMetrics struct{ calls int }

func (m *changingMarketMetrics) MarketMetrics(context.Context, readmodel.Snapshot, []displayprice.Reference) (map[string]*readmodel.MarketMetricsReadModel, error) {
	m.calls++
	values := []string{"300", "200", "100"}
	if m.calls > 1 {
		values = []string{"400", "100", "200"}
	}
	out := map[string]*readmodel.MarketMetricsReadModel{}
	for i, value := range values {
		out[fmt.Sprintf("0x%064x", i+1)] = &readmodel.MarketMetricsReadModel{Status: "available", MarketCapUSD: &value, Volume24hUSD: &value}
	}
	return out, nil
}

func TestMarketQueryCursorFreezesRankingAcrossMetricRefresh(t *testing.T) {
	s := marketQuerySnapshot(t)
	s.Markets = s.Markets[:3]
	metrics := &changingMarketMetrics{}
	h := New(Options{ChainID: 46630, ReadModels: fixtureReader{s}, MarketMetrics: metrics, MarketStatistics: &marketstats.Service{}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	first := marketPage(t, h, "/v1/markets?limit=1&sort=marketCapUsd_desc", 200)
	if len(first.Items) != 1 || first.Items[0].MarketID != s.Markets[0].MarketID || first.NextCursor == nil {
		t.Fatalf("unexpected first page: %+v", first)
	}
	second := marketPage(t, h, "/v1/markets?limit=1&sort=marketCapUsd_desc&cursor="+*first.NextCursor, 200)
	if len(second.Items) != 1 || second.Items[0].MarketID != s.Markets[1].MarketID {
		t.Fatalf("ranking was refreshed instead of frozen: %+v", second.Items)
	}
}
