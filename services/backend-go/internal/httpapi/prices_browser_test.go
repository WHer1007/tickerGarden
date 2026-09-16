package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"tickergarden/backend/internal/displayprice"
	"tickergarden/backend/internal/readmodel"
)

type browserPriceReader struct {
	state  atomic.Int32
	target *displayprice.Target
}

func (p *browserPriceReader) Read(now time.Time) []displayprice.Reference {
	asOf, expiry := now.Add(-time.Second), now.Add(time.Minute)
	bid, ask, mult := "26.68125", "26.68375", "0.125"
	reference := displayprice.Reference{Target: displayprice.Target{ChainID: 4663, Token: "0x" + strings.Repeat("1", 40), AssetUID: "0x" + strings.Repeat("2", 64), Symbol: "AAPL"}, Source: displayprice.Source, Unit: "USD_PER_WHOLE_TOKEN", Status: "available", AsOf: &asOf, ExpiresAt: &expiry, RetrievedAt: now, Multiplier: &mult, BidUSD: &bid, AskUSD: &ask}
	if p.target != nil {
		reference.Target = *p.target
	}
	if p.state.Load() == 1 {
		asOf = now.Add(-time.Minute)
		expiry = now.Add(-time.Second)
		reference.Status = "stale"
		reference.BidUSD = nil
		reference.AskUSD = nil
		reference.Reason = "price_expired"
	}
	return []displayprice.Reference{reference}
}

// Opt-in synthetic source through the production router, never an external quote.
func TestDisplayPriceBrowserFixture(t *testing.T) {
	target := os.Getenv("TG_TEST_PRICE_BROWSER_URL_FILE")
	if target == "" {
		t.Skip("set TG_TEST_PRICE_BROWSER_URL_FILE for the bounded local fixture")
	}
	reader := &browserPriceReader{}
	opts := Options{ChainID: 4663, DisplayPrices: reader, AllowedOrigin: "http://127.0.0.1:4394"}
	var directory *browserDirectoryReader
	if mode := os.Getenv("TG_TEST_PRICE_FULL_PAGE"); mode == "1" || mode == "trade" {
		raw, err := os.ReadFile("../../../../deployments/manifests/robinhood-mainnet-4663.paired-assets.json")
		if err != nil {
			t.Fatal(err)
		}
		var release struct {
			Assets []struct {
				Symbol, TokenAddress, AssetUID, PhantomQuote, GraduationThreshold string
				Decimals                                                          uint64
			}
		}
		if err = json.Unmarshal(raw, &release); err != nil {
			t.Fatal(err)
		}
		snapshot := testSnapshot(t)
		snapshot.Sync.ChainID = 4663
		snapshot.Sync.Revision = *snapshot.Sync.BlockNumber + ":" + *snapshot.Sync.BlockHash
		market := snapshot.Markets[0]
		snapshot.Markets = nil
		quote := snapshot.Configs[0]
		quote.Kind = "quote"
		quote.Source.ChainID = 4663
		for _, asset := range release.Assets {
			if asset.Symbol == "NVDA" {
				market.MemeToken = asset.TokenAddress
			}
			if asset.Symbol == "AAPL" {
				reader.target = &displayprice.Target{ChainID: 4663, Token: asset.TokenAddress, AssetUID: asset.AssetUID, Symbol: asset.Symbol}
				quote.Values = map[string]any{"quoteAsset": asset.TokenAddress, "quoteDecimals": asset.Decimals, "phantomQuote": asset.PhantomQuote, "graduationThreshold": asset.GraduationThreshold, "tickerGardenBaselineId": quote.ID}
			}
		}
		if reader.target == nil {
			t.Fatal("AAPL release fixture missing")
		}
		if mode == "trade" {
			market.Source.ChainID = 4663
			market.QuoteAsset = reader.target.Token
			market.QuoteAssetConfigID = quote.ID
			snapshot.Markets = []readmodel.MarketReadModel{market}
		}
		snapshot.Configs = []readmodel.ConfigReadModel{quote}
		directory = &browserDirectoryReader{snapshot: snapshot}
		opts.ReadModels = directory
	}
	api := New(opts)
	stop := make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/__fixture/") {
			if r.Method != http.MethodPost {
				w.WriteHeader(405)
				return
			}
			switch r.URL.Path {
			case "/__fixture/stop":
				once.Do(func() { close(stop) })
			case "/__fixture/stale":
				reader.state.Store(1)
			case "/__fixture/available":
				reader.state.Store(0)
				if directory != nil {
					directory.unavailable.Store(false)
				}
			case "/__fixture/snapshot-failure":
				if directory != nil {
					directory.unavailable.Store(true)
				}
			case "/__fixture/failure":
				reader.state.Store(2)
			default:
				w.WriteHeader(404)
				return
			}
			w.WriteHeader(204)
			return
		}
		if reader.state.Load() == 2 && r.URL.Path == "/v1/prices/references" {
			w.Header().Set("Access-Control-Allow-Origin", "http://127.0.0.1:4394")
			w.Header().Set("Cache-Control", "no-store")
			http.Error(w, "fixture unavailable", 503)
			return
		}
		api.ServeHTTP(w, r)
	}))
	defer server.Close()
	if err := os.WriteFile(target, []byte(server.URL), 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(target)
	duration := 180 * time.Second
	if mode := os.Getenv("TG_TEST_PRICE_FULL_PAGE"); mode == "1" || mode == "trade" {
		duration = 10 * time.Minute
	}
	select {
	case <-stop:
	case <-time.After(duration):
		t.Fatal("price browser fixture timed out")
	}
}
