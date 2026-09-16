package marketstats

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/displayprice"
	"time"
)

func TestNativePriceFallbackPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, primary, fallback string
		wantSource              string
		wantCalls               int32
	}{
		{"primary", `{"data":{"base":"ETH","currency":"USD","amount":"3000"}}`, `{"result":{"XETHZUSD":{"c":["1"]}}}`, "coinbase_spot", 1},
		{"fallback", `{"data":{"base":"ETH","currency":"USD","amount":"0"}}`, `{"result":{"XETHZUSD":{"c":["3000"]}}}`, "kraken_ticker", 2},
		{"invalid both", `{"data":{"base":"BTC","currency":"USD","amount":"3000"}}`, `{"result":{"XETHZUSD":{"c":["-1"]}}}`, "", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&calls, 1)
				w.Header().Set("content-type", "application/json")
				if n == 1 {
					w.Write([]byte(tc.primary))
					return
				}
				w.Write([]byte(tc.fallback))
			}))
			defer s.Close()
			p := NewPrices(46630, nil)
			p.NativePrimaryURL, p.NativeFallbackURL = s.URL, s.URL
			p.refresh(context.Background())
			if calls != tc.wantCalls {
				t.Fatalf("calls=%d want %d", calls, tc.wantCalls)
			}
			if tc.wantSource == "" {
				if len(p.Read(time.Now())) != 0 {
					t.Fatal("invalid price became available")
				}
				return
			}
			if p.native == nil || p.native.Source != tc.wantSource {
				t.Fatalf("native=%+v", p.native)
			}
		})
	}
}

func TestInvalidNativePricesDoNotReviveExpiredReference(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer s.Close()
	p := NewPrices(46630, nil)
	p.NativePrimaryURL = s.URL
	p.NativeFallbackURL = s.URL
	asOf := time.Now().Add(-30 * time.Minute)
	expiry := time.Now().Add(-10 * time.Minute)
	amount := "3000"
	p.native = &displayprice.Reference{Target: displayprice.Target{ChainID: 46630, Token: zero}, Status: "available", Unit: "USD_PER_WHOLE_TOKEN", BidUSD: &amount, AskUSD: &amount, AsOf: &asOf, ExpiresAt: &expiry}
	p.refresh(context.Background())
	if len(p.Read(time.Now())) != 0 {
		t.Fatal("expired reference revived")
	}
	for _, v := range []string{"1/2", "0x10", "1e9", "-1", "0", "NaN"} {
		if validPositiveAmount(v) {
			t.Fatalf("invalid decimal accepted: %s", v)
		}
	}
}
