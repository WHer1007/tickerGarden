package httpapi

import (
	"net/url"
	"sort"
	"testing"
	"tickergarden/backend/internal/readmodel"
)

func TestMarketNameAndPhaseGlobalPagination(t *testing.T) {
	s := identityMarketSnapshot(t)
	names := []string{"Zulu", "a", "A", "a/b", "a:b", "a\x00b", "Älg", "中文"}
	for i := range s.Markets {
		s.Markets[i].Identity.Name = names[i%len(names)]
	}
	for _, order := range []string{"name_asc", "launchPhase_asc"} {
		expected := append([]readmodel.MarketReadModel(nil), s.Markets...)
		sort.Slice(expected, func(i, j int) bool {
			a, b := expected[i], expected[j]
			if order == "name_asc" && asciiLower(a.Identity.Name) != asciiLower(b.Identity.Name) {
				return asciiLower(a.Identity.Name) < asciiLower(b.Identity.Name)
			}
			if order == "launchPhase_asc" && a.LaunchPhase != b.LaunchPhase {
				return a.LaunchPhase < b.LaunchPhase
			}
			return a.MarketID < b.MarketID
		})
		h := marketQueryHandler(s)
		cursor := ""
		index := 0
		for {
			q := url.Values{"sort": {order}, "limit": {"17"}}
			if cursor != "" {
				q.Set("cursor", cursor)
			}
			page := marketPage(t, h, "/v1/markets?"+q.Encode(), 200)
			for _, m := range page.Items {
				if index >= len(expected) || m.MarketID != expected[index].MarketID {
					t.Fatal(order, index, m.MarketID)
				}
				index++
			}
			if page.NextCursor == nil {
				break
			}
			cursor = *page.NextCursor
		}
		if index != 130 {
			t.Fatal(order, index)
		}
		first := marketPage(t, h, "/v1/markets?limit=17&sort="+order, 200)
		marketPage(t, h, "/v1/markets?limit=17&sort=marketId_asc&cursor="+url.QueryEscape(*first.NextCursor), 400)
	}
	s.Markets[0].Identity = nil
	h := marketQueryHandler(s)
	marketPage(t, h, "/v1/markets?sort=name_asc", 503)
	marketPage(t, h, "/v1/markets?sort=launchPhase_asc", 200)
}
