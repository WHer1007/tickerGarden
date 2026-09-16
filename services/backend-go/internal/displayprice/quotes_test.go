package displayprice

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestBulkQuotesFailClosedPerTarget(t *testing.T) {
	for _, mode := range []string{"good", "duplicate", "missing", "deployment", "429", "null", "oversized"} {
		t.Run(mode, func(t *testing.T) {
			p, target, now := priceFixture(t, "")
			original := p.Client.Transport
			calls := 0
			p.Client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != "/rhj/prices" {
					return original.RoundTrip(r)
				}
				calls++
				halt := false
				q := quote{Symbol: target.Symbol, Bid: "100", Ask: "101", Currency: "USD", Halt: &halt, Generated: now.Add(-time.Second).Format(time.RFC3339Nano), Deployments: []deployment{{ChainID: 4663, Address: target.Token}}}
				other := q
				other.Symbol = "OTHER"
				quotes := []quote{other, q}
				code := 200
				switch mode {
				case "duplicate":
					quotes = append(quotes, q)
				case "missing":
					quotes = []quote{other}
				case "deployment":
					quotes[1].Deployments = []deployment{{ChainID: 46630, Address: target.Token}}
				case "429":
					code = 429
				case "null":
					quotes = nil
				case "oversized":
					quotes = make([]quote, 1025)
				}
				raw, _ := json.Marshal(map[string]any{"quotes": quotes})
				return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
			})
			b := &batch{bulk: true}
			for i := 0; i < 2; i++ {
				r := p.fetch(context.Background(), target, now, b)
				if (r.Status == "available") != (mode == "good") {
					t.Fatalf("unexpected %+v", r)
				}
				if mode != "good" && (r.BidUSD != nil || r.AskUSD != nil) {
					t.Fatal("price leaked")
				}
			}
			if calls != 1 {
				t.Fatal("bulk success/failure not shared")
			}
		})
	}
}
