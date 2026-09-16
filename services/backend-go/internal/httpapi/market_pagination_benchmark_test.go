package httpapi

import (
	"fmt"
	"net/url"
	"testing"
	"tickergarden/backend/internal/readmodel"
)

func BenchmarkMarketSortedPage(b *testing.B) {
	for _, size := range []int{1000, 10000, 50000} {
		for _, order := range []string{"name_asc", "createdAt_desc"} {
			b.Run(fmt.Sprintf("n=%d/%s", size, order), func(b *testing.B) {
				items := make([]readmodel.MarketReadModel, size)
				for i := range items {
					items[i] = readmodel.MarketReadModel{MarketID: fmt.Sprintf("0x%064x", i+1), Identity: &readmodel.MarketIdentityReadModel{Name: fmt.Sprintf("Market %06d", (i*7919)%size), Symbol: "TG", DeployedAt: fmt.Sprint(1000 + i%700)}}
				}
				q := url.Values{"sort": {order}, "limit": {"100"}}
				sync := readmodel.SyncStatus{Revision: "benchmark"}
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					filtered, filter, key, err := queryMarkets(items, q)
					if err != nil {
						b.Fatal(err)
					}
					page, err := paginate(filtered, q, "markets", filter, sync, key)
					if err != nil || len(page.Items) != 100 || page.NextCursor == nil {
						b.Fatal(len(page.Items), err)
					}
				}
			})
		}
	}
}
