package marketstats

import (
	"math/big"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/displayprice"
)

type testPrices []displayprice.Reference

func (p testPrices) Read(time.Time) []displayprice.Reference { return p }

func ref(chain uint64, token, bid, ask string, asOf, expires time.Time) displayprice.Reference {
	return displayprice.Reference{Target: displayprice.Target{ChainID: chain, Token: token}, Source: "test", Unit: "USD_PER_WHOLE_TOKEN", Status: "available", BidUSD: &bid, AskUSD: &ask, AsOf: &asOf, ExpiresAt: &expires}
}

func TestSpotReciprocalQuoteDecimals(t *testing.T) {
	sqrt := new(big.Int).Lsh(big.NewInt(1), 96)
	got, err := Spot(sqrt, true, 6)
	if err != nil || !strings.HasPrefix(got, "1000000000000.") {
		t.Fatalf("spot decimals6 = %q, %v", got, err)
	}
	got, err = Spot(sqrt, false, 18)
	if err != nil || !strings.HasPrefix(got, "1.") {
		t.Fatalf("spot reciprocal decimals18 = %q, %v", got, err)
	}
}

func TestCalculateUsesSupplyAndNoTrades(t *testing.T) {
	now := time.Unix(2_000_000, 0).UTC()
	bid, ask := "2", "2"
	s := Service{Chain: 46630, Prices: testPrices{ref(46630, "0xquote", bid, ask, now.Add(-time.Minute), now.Add(time.Hour))}}
	v := State{Quote: "0xquote", Price: "3", Supply: "1000000000000000000", StatsAt: 0}
	s.calculate(&v, now)
	if v.Metrics == nil || v.Metrics.Status != "available" || v.Metrics.MarketCapUSD == nil {
		t.Fatalf("expected available market cap: %#v", v.Metrics)
	}
	if *v.Metrics.MarketCapUSD != "6.000000000000000000" {
		t.Fatalf("market cap = %s", *v.Metrics.MarketCapUSD)
	}
}

func TestCalculateCacheWindowAndReprice(t *testing.T) {
	now := time.Unix(2_000_000, 0).UTC()
	bid, ask := "2", "2"
	p := testPrices{ref(46630, "0xquote", bid, ask, now.Add(-time.Minute), now.Add(time.Hour))}
	s := Service{Chain: 46630, Prices: p}
	v := State{Quote: "0xquote", Price: "3", Supply: "1000000000000000000"}
	s.calculate(&v, now)
	first := *v.Metrics.MarketCapUSD
	v.Price = "9"
	s.calculate(&v, now.Add(1199*time.Second))
	if *v.Metrics.MarketCapUSD != first {
		t.Fatal("cache changed before 1200 seconds")
	}
	s.calculate(&v, now.Add(1200*time.Second))
	if *v.Metrics.MarketCapUSD == first {
		t.Fatal("cache did not reprice at 1200 seconds")
	}
}

func TestCalculateUnavailableReferences(t *testing.T) {
	now := time.Unix(2_000_000, 0).UTC()
	base := State{Quote: "0xquote", Price: "3", Supply: "1"}
	cases := []testPrices{
		{ref(46630, "0xquote", "2", "2", now.Add(-time.Hour), now.Add(-time.Minute))},
		{ref(46630, "0xquote", "2", "2", now.Add(time.Minute), now.Add(time.Hour))},
		{ref(46630, "0xquote", "2", "2", now.Add(-time.Minute), now.Add(time.Hour)), ref(46630, "0xquote", "2", "2", now.Add(-time.Minute), now.Add(time.Hour))},
	}
	for i, prices := range cases {
		s := Service{Chain: 46630, Prices: prices}
		v := base
		s.calculate(&v, now)
		if v.Metrics == nil || v.Metrics.Status != "unavailable" {
			t.Fatalf("case %d: %#v", i, v.Metrics)
		}
	}
}

func TestCalculateKeepsTokenAddressesSeparate(t *testing.T) {
	now := time.Unix(2_000_000, 0).UTC()
	bid, ask := "2", "2"
	s := Service{Chain: 46630, Prices: testPrices{ref(46630, "0xaaa", bid, ask, now.Add(-time.Minute), now.Add(time.Hour))}}
	v := State{Quote: "0xbbb", Price: "3", Supply: "1"}
	s.calculate(&v, now)
	if v.Metrics == nil || v.Metrics.Status != "unavailable" {
		t.Fatalf("ticker/address collision made reference available: %#v", v.Metrics)
	}
}
