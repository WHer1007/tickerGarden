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
