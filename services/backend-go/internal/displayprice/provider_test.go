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

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func priceFixture(t *testing.T, mode string) (Provider, Target, time.Time) {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Second)
	target := Target{ChainID: 4663, Token: "0x" + strings.Repeat("1", 40), AssetUID: "0x" + strings.Repeat("2", 64), Symbol: "AAPL"}
	deps := []any{map[string]any{"chainId": 4663, "contractAddress": target.Token}}
	a := map[string]any{"id": target.AssetUID, "tokenSymbol": "AAPL", "status": "ASSET_STATUS_ACTIVE", "currentMultiplier": "0.125000000000000000", "pendingMultiplier": "", "deployments": deps}
	q := map[string]any{"tokenSymbol": "AAPL", "currency": "USD", "bid": "213.45", "ask": "213.47", "generatedAt": now.Add(-time.Second).Format(time.RFC3339), "isTradingHalt": false, "deployments": deps}
	actions := []any{}
	switch mode {
	case "asset":
		a["id"] = "wrong"
	case "deployment":
		a["deployments"] = []any{}
	case "inactive":
		a["status"] = "ASSET_STATUS_INACTIVE"
	case "pending":
		a["pendingMultiplier"] = "2"
	case "missing-multiplier":
		delete(a, "currentMultiplier")
	case "missing-pending":
		delete(a, "pendingMultiplier")
	case "halt":
		q["isTradingHalt"] = true
	case "missing-halt":
		delete(q, "isTradingHalt")
	case "currency":
		q["currency"] = "EUR"
	case "symbol":
		q["tokenSymbol"] = "TSLA"
	case "crossed":
		q["bid"] = "214"
	case "zero":
		q["ask"] = "0"
	case "float":
		q["bid"] = 213.45
	case "exponent":
		q["bid"] = "2e2"
	case "stale":
		q["generatedAt"] = now.Add(-time.Minute).Format(time.RFC3339)
	case "future":
		q["generatedAt"] = now.Add(time.Second).Format(time.RFC3339)
	case "action":
		actions = append(actions, map[string]any{"tokenSymbol": "AAPL", "status": "CORPORATE_ACTION_STATUS_IN_PROGRESS"})
	}
	p := NewProvider()
	p.Client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "api.robinhood.com" || r.URL.Scheme != "https" {
			t.Fatal("unexpected upstream")
		}
		var body any
		switch r.URL.Path {
		case "/rhj/assets":
			xs := []any{a}
			if mode == "duplicate" {
				xs = append(xs, a)
			}
			body = map[string]any{"assets": xs}
		case "/rhj/corporate-actions":
			body = map[string]any{"corpActions": actions}
			if mode == "missing-actions" {
				body = map[string]any{}
			}
		case "/rhj/prices/AAPL":
			body = map[string]any{"quotes": []any{q}}
		default:
			t.Fatal("unexpected path", r.URL.Path)
		}
		raw, _ := json.Marshal(body)
		code := 200
		if mode == "429" {
			code = 429
		}
		if mode == "oversized" {
			raw = []byte(strings.Repeat(" ", 2<<20+1))
		}
		return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(string(raw))), Header: make(http.Header)}, nil
	})
	return p, target, now
}
func TestRESTPriceAndMultiplierOnce(t *testing.T) {
	p, target, now := priceFixture(t, "")
	r := p.Fetch(context.Background(), target, now)
	if r.Status != "available" || r.BidUSD == nil || *r.BidUSD != "26.68125" || *r.AskUSD != "26.68375" || r.Unit != "USD_PER_WHOLE_TOKEN" {
		t.Fatal(r)
	}
	stale := expire(r, now.Add(time.Minute))
	if stale.Status != "stale" || stale.BidUSD != nil || stale.AskUSD != nil || stale.AsOf == nil {
		t.Fatal(stale)
	}
}
func TestUnavailableAndStale(t *testing.T) {
	for _, mode := range []string{"asset", "deployment", "inactive", "pending", "missing-multiplier", "missing-pending", "halt", "missing-halt", "currency", "symbol", "crossed", "zero", "float", "exponent", "future", "stale", "action", "missing-actions", "duplicate", "429", "oversized"} {
		t.Run(mode, func(t *testing.T) {
			p, target, now := priceFixture(t, mode)
			r := p.Fetch(context.Background(), target, now)
			if r.Status == "available" || r.BidUSD != nil || r.AskUSD != nil {
				t.Fatal(r)
			}
			if mode == "stale" && r.Status != "stale" {
				t.Fatal(r)
			}
		})
	}
}
func TestExactDecimal(t *testing.T) {
	for _, tc := range []struct{ a, b, w string }{{"1000", "1", "1000"}, {"0.000000000000000001", "0.000000000000000001", "0.000000000000000000000000000000000001"}, {"9007199254740993", "3", "27021597764222979"}} {
		s, e := product(tc.a, tc.b)
		if e != nil || s != tc.w {
			t.Fatal(s, e)
		}
	}
	for _, s := range []string{"0", "-1", "01", "1e3", "NaN", "1.", ".1", strings.Repeat("9", 61)} {
		if _, e := product(s, "1"); e == nil {
			t.Fatal(s)
		}
	}
}
func TestServiceRefreshAndConfig(t *testing.T) {
	p, target, now := priceFixture(t, "")
	s, e := New([]Target{target}, 4663, p)
	if e != nil {
		t.Fatal(e)
	}
	if s.Read(now)[0].Status != "unavailable" {
		t.Fatal("not initialized")
	}
	// Use a fixture quote relative to test time; refresh may mark it stale, but
	// the read path must retain provider provenance and obey expiry.
	s.refresh(context.Background())
	if s.Read(now)[0].Source != Source || s.Read(now)[0].Status != "available" {
		t.Fatal("source")
	}
	for _, targets := range [][]Target{nil, {target, target}} {
		if _, e := New(targets, 4663, p); e == nil {
			t.Fatal("config accepted")
		}
	}
	if _, e := New([]Target{target}, 46630, p); e == nil {
		t.Fatal("wrong chain")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() { s.Run(ctx); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("shutdown")
	}
}
