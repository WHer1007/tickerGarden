package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/displayprice"
	"tickergarden/backend/internal/readmodel"
	"time"
)

func TestDisplayPriceEndpoint(t *testing.T) {
	h := New(Options{ChainID: 4663})
	for _, tc := range []struct {
		method, path string
		code         int
	}{{"GET", "/v1/prices/references", 200}, {"GET", "/v1/prices/references?symbol=AAPL", 400}, {"POST", "/v1/prices/references", 405}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != tc.code {
			t.Fatal(w.Code, w.Body.String())
		}
		if tc.code == 200 {
			var v struct {
				DisplayOnly bool
				Status      string
				References  []any
			}
			if json.Unmarshal(w.Body.Bytes(), &v) != nil || !v.DisplayOnly || v.Status != "not_configured" || v.References == nil {
				t.Fatal(w.Body.String())
			}
		}
	}
}

type displayFixture []displayprice.Reference

func (f displayFixture) Read(time.Time) []displayprice.Reference { return f }
func TestDisplayPricesMatchContract(t *testing.T) {
	now := time.Now().UTC()
	expiry := now.Add(time.Minute)
	bid, ask, mult := "26.68125", "26.68375", "0.125"
	for _, status := range []string{"available", "stale", "unavailable"} {
		r := displayprice.Reference{Target: displayprice.Target{ChainID: 4663, Token: "0x" + strings.Repeat("1", 40), AssetUID: "0x" + strings.Repeat("2", 64), Symbol: "AAPL"}, Source: displayprice.Source, Unit: "USD_PER_WHOLE_TOKEN", Status: status, AsOf: &now, ExpiresAt: &expiry, RetrievedAt: now, Multiplier: &mult}
		if status == "available" {
			r.BidUSD = &bid
			r.AskUSD = &ask
		} else {
			r.Reason = "price_expired"
		}
		h := New(Options{ChainID: 4663, DisplayPrices: displayFixture{r}})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/prices/references", nil))
		if e := readmodel.ValidateResponse("DisplayPriceResponse", w.Body.Bytes()); e != nil {
			t.Fatal(status, e)
		}
		var body map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		item := body["references"].([]any)[0].(map[string]any)
		if status != "available" {
			item["bidUsd"] = "1"
		} else {
			item["bidUsd"] = nil
		}
		invalid, _ := json.Marshal(body)
		if readmodel.ValidateResponse("DisplayPriceResponse", invalid) == nil {
			t.Fatal("accepted invalid status/price pair")
		}
	}
}

func TestDisplayPriceCatalogContractLimit(t *testing.T) {
	refs := make(displayFixture, displayprice.MaxTargets)
	for i := range refs {
		refs[i] = displayprice.Reference{Target: displayprice.Target{ChainID: 4663, Token: "0x" + strings.Repeat("1", 40), AssetUID: "0x" + strings.Repeat("2", 64), Symbol: "AAPL"}, Source: displayprice.Source, Unit: "USD_PER_WHOLE_TOKEN", Status: "unavailable", RetrievedAt: time.Now().UTC()}
	}
	for _, extra := range []bool{false, true} {
		if extra {
			refs = append(refs, refs[0])
		}
		w := httptest.NewRecorder()
		New(Options{ChainID: 4663, DisplayPrices: refs}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/prices/references", nil))
		err := readmodel.ValidateResponse("DisplayPriceResponse", w.Body.Bytes())
		if (err != nil) != extra {
			t.Fatalf("catalog contract limit mismatch: %v", err)
		}
	}
}
