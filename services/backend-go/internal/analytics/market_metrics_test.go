package analytics

import (
	"math/big"
	"testing"
	"time"

	"tickergarden/backend/internal/displayprice"
)

func TestMarketMetricDecimalAndUniqueAddressPrice(t *testing.T) {
	if got := decimal18(big.NewRat(21, 2)); got != "10.5" {
		t.Fatalf("decimal18=%s", got)
	}
	if got := decimal18(big.NewRat(1, 3)); got != "0.333333333333333333" {
		t.Fatalf("decimal18 truncation=%s", got)
	}
	now := time.Unix(100, 0).UTC()
	bid, ask := "10", "12"
	ref := displayprice.Reference{Target: displayprice.Target{ChainID: 4663, Token: "0x" + "1" + "000000000000000000000000000000000000000"}, Source: displayprice.Source, Unit: "USD_PER_WHOLE_TOKEN", Status: "available", BidUSD: &bid, AskUSD: &ask, AsOf: &now, ExpiresAt: &now}
	prices := uniqueQuotePrices([]displayprice.Reference{ref}, 4663)
	if len(prices) != 1 || prices[ref.Token].bid.String() != "10/1" {
		t.Fatalf("unexpected price map: %+v", prices)
	}
	if got := uniqueQuotePrices([]displayprice.Reference{ref, ref}, 4663); len(got) != 0 {
		t.Fatalf("duplicate token references must fail closed: %+v", got)
	}
}
