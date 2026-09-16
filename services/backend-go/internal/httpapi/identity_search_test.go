package httpapi

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"tickergarden/backend/internal/readmodel"
)

func identityMarketSnapshot(t *testing.T) readmodel.Snapshot {
	t.Helper()
	s := marketQuerySnapshot(t)
	for i := range s.Markets {
		m := &s.Markets[i]
		m.Identity = &readmodel.MarketIdentityReadModel{
			Name:       fmt.Sprintf("Market %03d", i),
			Symbol:     fmt.Sprintf("TG%03d", i),
			DeployedAt: fmt.Sprintf("%d", 1000+i%7),
		}
	}
	return s
}

func TestMarketIdentitySearchFullDirectoryAndASCIIInsensitive(t *testing.T) {
	s := identityMarketSnapshot(t)
	s.Markets[127].Identity.Name = "Älg Orchard"
	s.Markets[128].Identity.Symbol = "MiXeD"
	h := marketQueryHandler(s)

	p := marketPage(t, h, "/v1/markets?limit=100&search=market", http.StatusOK)
	if len(p.Items) != 100 || p.NextCursor == nil {
		t.Fatalf("expected first page of full directory, got %d items cursor=%v", len(p.Items), p.NextCursor)
	}
	p = marketPage(t, h, "/v1/markets?limit=100&search=MARKET&cursor="+*p.NextCursor, http.StatusOK)
	if len(p.Items) != 29 {
		t.Fatalf("expected remaining 29 markets, got %d", len(p.Items))
	}
	if got := marketPage(t, h, "/v1/markets?search=MiXeD", http.StatusOK); len(got.Items) != 0 {
		t.Fatalf("symbol search must remain outside the V1 search contract: %+v", got.Items)
	}
	if got := marketPage(t, h, "/v1/markets?search=Älg", http.StatusOK); len(got.Items) != 1 || got.Items[0].MarketID != s.Markets[127].MarketID {
		t.Fatalf("UTF-8 literal search failed: %+v", got.Items)
	}
	if got := marketPage(t, h, "/v1/markets?search=0x"+strings.ToUpper(s.Markets[129].MemeToken[2:]), http.StatusOK); len(got.Items) == 0 {
		t.Fatalf("Meme Token address search failed: %d", len(got.Items))
	}
	marketPage(t, h, "/v1/markets?search="+strings.ToUpper(s.Markets[129].MarketID), http.StatusBadRequest)
}

func TestMarketIdentityCreatedBoundsAndSortAcrossPages(t *testing.T) {
	s := identityMarketSnapshot(t)
	h := marketQueryHandler(s)
	if got := marketPage(t, h, "/v1/markets?createdFrom=1002&createdTo=1002", http.StatusOK); len(got.Items) != 19 {
		t.Fatalf("inclusive bounds returned %d", len(got.Items))
	}
	for _, order := range []string{"createdAt_asc", "createdAt_desc"} {
		var cursor, previousTime, previousID string
		seen := 0
		for {
			path := "/v1/markets?limit=13&sort=" + order
			if cursor != "" {
				path += "&cursor=" + cursor
			}
			p := marketPage(t, h, path, http.StatusOK)
			for _, m := range p.Items {
				currentTime, currentID := m.Identity.DeployedAt, m.MarketID
				if previousTime != "" && ((order == "createdAt_asc" && (currentTime < previousTime || currentTime == previousTime && currentID <= previousID)) || (order == "createdAt_desc" && (currentTime > previousTime || currentTime == previousTime && currentID <= previousID))) {
					t.Fatalf("bad %s ordering: %s:%s after %s:%s", order, currentTime, currentID, previousTime, previousID)
				}
				previousTime, previousID, seen = currentTime, currentID, seen+1
			}
			if p.NextCursor == nil {
				break
			}
			cursor = *p.NextCursor
		}
		if seen != len(s.Markets) {
			t.Fatalf("%s returned %d", order, seen)
		}
	}
	first := marketPage(t, h, "/v1/markets?limit=2&search=Market", http.StatusOK)
	for _, path := range []string{"/v1/markets?limit=2&search=Other&cursor=" + *first.NextCursor, "/v1/markets?limit=2&createdFrom=1001&cursor=" + *first.NextCursor} {
		marketPage(t, h, path, http.StatusBadRequest)
	}
}

func TestMarketIdentityMissingReturns503AndInvalidRange400(t *testing.T) {
	s := identityMarketSnapshot(t)
	s.Markets[4].Identity = nil
	h := marketQueryHandler(s)
	for _, path := range []string{"/v1/markets?search=market", "/v1/markets?createdFrom=1000", "/v1/markets?sort=createdAt_desc"} {
		marketPage(t, h, path, http.StatusServiceUnavailable)
	}
	for _, path := range []string{"/v1/markets?createdFrom=10&createdTo=9", "/v1/markets?createdFrom=-1", "/v1/markets?createdTo=9223372036854775808"} {
		marketPage(t, h, path, http.StatusBadRequest)
	}
	if got := marketPage(t, h, "/v1/markets?marketId="+s.Markets[0].MarketID, http.StatusOK); len(got.Items) != 1 {
		t.Fatal("legacy ID query should work without identity")
	}
}
