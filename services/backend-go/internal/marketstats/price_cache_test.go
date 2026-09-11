package marketstats

import (
	"testing"
	"time"

	"tickergarden/backend/internal/displayprice"
)

func cachedPriceReference(now time.Time) displayprice.Reference {
	asOf := now.Add(-5 * time.Minute)
	expires := now.Add(5 * time.Minute)
	bid, ask := "10", "11"
	return displayprice.Reference{
		Target:    displayprice.Target{ChainID: 46630, Token: "0x0000000000000000000000000000000000000001"},
		Status:    "available",
		Unit:      "USD_PER_WHOLE_TOKEN",
		BidUSD:    &bid,
		AskUSD:    &ask,
		AsOf:      &asOf,
		ExpiresAt: &expires,
	}
}

func TestUsableCachedPriceBoundaries(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		mutate func(*displayprice.Reference)
		want   bool
	}{
		{name: "valid reference", want: true},
		{name: "expired", mutate: func(r *displayprice.Reference) { v := now.Add(-time.Second); r.ExpiresAt = &v }, want: false},
		{name: "future as of", mutate: func(r *displayprice.Reference) { v := now.Add(time.Second); r.AsOf = &v }, want: false},
		{name: "wrong chain", mutate: func(r *displayprice.Reference) { r.ChainID = 4663 }, want: false},
		{name: "lifetime over twenty minutes", mutate: func(r *displayprice.Reference) { v := now.Add(16 * time.Minute); r.ExpiresAt = &v }, want: false},
		{name: "negative bid", mutate: func(r *displayprice.Reference) { v := "-1"; r.BidUSD = &v }, want: false},
		{name: "negative ask", mutate: func(r *displayprice.Reference) { v := "-1"; r.AskUSD = &v }, want: false},
		{name: "ask below bid", mutate: func(r *displayprice.Reference) { v := "9"; r.AskUSD = &v }, want: false},
		{name: "missing bid", mutate: func(r *displayprice.Reference) { r.BidUSD = nil }, want: false},
		{name: "missing ask", mutate: func(r *displayprice.Reference) { r.AskUSD = nil }, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ref := cachedPriceReference(now)
			if test.mutate != nil {
				test.mutate(&ref)
			}
			if got := usableCachedPrice(ref, 46630, now); got != test.want {
				t.Fatalf("usableCachedPrice()=%v, want %v", got, test.want)
			}
		})
	}
}

func TestUsableCachedPriceDoesNotExtendExpiry(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	ref := cachedPriceReference(now)
	originalExpiry := *ref.ExpiresAt
	if !usableCachedPrice(ref, 46630, now) {
		t.Fatal("expected reference to be usable")
	}
	if !ref.ExpiresAt.Equal(originalExpiry) {
		t.Fatalf("expiry changed from %s to %s", originalExpiry, *ref.ExpiresAt)
	}
}
