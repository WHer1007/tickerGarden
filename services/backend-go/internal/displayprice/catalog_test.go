package displayprice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestFullCatalogRefresh(t *testing.T) {
	targets := make([]Target, MaxTargets)
	assets := make([]asset, MaxTargets)
	mult, pending, halt := "1", "", false
	for i := range targets {
		targets[i] = Target{ChainID: 4663, Token: fmt.Sprintf("0x%040x", i+1), AssetUID: fmt.Sprintf("0x%064x", i+1), Symbol: fmt.Sprintf("S%02d", i)}
		assets[i] = asset{ID: targets[i].AssetUID, Symbol: targets[i].Symbol, Status: "ASSET_STATUS_ACTIVE", Multiplier: &mult, Pending: &pending, Deployments: []deployment{{ChainID: 4663, Address: targets[i].Token}}}
	}
	p := NewProvider()
	var mu sync.Mutex
	counts := map[string]int{}
	p.Client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		counts[r.URL.Path]++
		mu.Unlock()
		var body any
		switch r.URL.Path {
		case "/rhj/assets":
			body = map[string]any{"assets": assets}
		case "/rhj/corporate-actions":
			body = map[string]any{"corpActions": []any{}}
		case "/rhj/prices":
			quotes := []quote{}
			for _, target := range targets {
				quotes = append(quotes, quote{Symbol: target.Symbol, Bid: "100", Ask: "101", Currency: "USD", Halt: &halt, Generated: time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano), Deployments: []deployment{{ChainID: 4663, Address: target.Token}}})
			}
			body = map[string]any{"quotes": quotes}
		default:
			t.Errorf("unexpected URL %s", r.URL)
		}
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
	})
	s, err := New(targets, 4663, p)
	if err != nil {
		t.Fatal(err)
	}
	result := s.Check(context.Background())
	if !result.AllAvailable || len(result.References) != MaxTargets {
		t.Fatalf("catalog failed: %+v", result)
	}
	for i, ref := range result.References {
		if ref.Target != targets[i] || ref.BidUSD == nil || *ref.BidUSD != "100" {
			t.Fatalf("target lost or mixed: %+v", ref)
		}
		if counts["/rhj/prices/"+ref.Symbol] != 0 {
			t.Fatal("quote request duplicated or missing")
		}
	}
	if counts["/rhj/prices"] != 1 || counts["/rhj/assets"] != 1 || counts["/rhj/corporate-actions"] != 1 {
		t.Fatal("shared request duplicated")
	}
	extra := Target{ChainID: 4663, Token: fmt.Sprintf("0x%040x", 100), AssetUID: fmt.Sprintf("0x%064x", 100), Symbol: "EXTRA"}
	if _, err := New(append(targets, extra), 4663, p); err == nil {
		t.Fatal("oversized catalog accepted")
	}
}
