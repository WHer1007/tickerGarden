package marketstats

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"sync"
	"tickergarden/backend/internal/displayprice"
	"time"
)

// Native ETH has one shared public USD reference. Stock quotes are supplied by
// the existing configured display-price provider, never by a stock ticker guess.
type PriceService struct {
	cachePool         *pgxpool.Pool
	cacheRegistry     string
	Chain             uint64
	Configured        Prices
	mu                sync.RWMutex
	native            *displayprice.Reference
	stockRPC          RPC
	stockRoutes       map[string]stockRoute
	stockRefs         map[string]displayprice.Reference
	stockAttempts     map[string]time.Time
	HTTPClient        httpClient
	NativePrimaryURL  string
	NativeFallbackURL string
}

type httpClient interface {
	Do(*http.Request) (*http.Response, error)
}

func NewPrices(chain uint64, configured Prices) *PriceService {
	return &PriceService{Chain: chain, Configured: configured, HTTPClient: http.DefaultClient, NativePrimaryURL: "https://api.coinbase.com/v2/prices/ETH-USD/spot", NativeFallbackURL: "https://api.kraken.com/0/public/Ticker?pair=ETHUSD"}
}
func (p *PriceService) Read(now time.Time) []displayprice.Reference {
	refs := []displayprice.Reference{}
	if p.Configured != nil {
		refs = p.Configured.Read(now)
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	hasNative := false
	known := map[string]bool{}
	for _, r := range refs {
		if r.Status == "available" {
			known[r.Token] = true
			if r.Token == zero {
				hasNative = true
			}
		}
	}
	for token, r := range p.stockRefs {
		if !known[token] && now.Before(*r.ExpiresAt) {
			refs = append(refs, r)
		}
	}
	if !hasNative && p.native != nil && now.Before(*p.native.ExpiresAt) {
		refs = append(refs, *p.native)
	}
	return refs
}
func (p *PriceService) Run(ctx context.Context) {
	p.refresh(ctx)
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.refresh(ctx)
		}
	}
}
func (p *PriceService) refresh(ctx context.Context) {
	p.mu.RLock()
	native := p.native
	p.mu.RUnlock()
	if native != nil && native.AsOf != nil && time.Since(*native.AsOf) < 10*time.Minute {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	client := p.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	urls := []string{p.NativePrimaryURL, p.NativeFallbackURL}
	var amount, source string
	for i, endpoint := range urls {
		if endpoint == "" {
			continue
		}
		attemptCtx, stop := context.WithTimeout(ctx, 4*time.Second)
		req, e := http.NewRequestWithContext(attemptCtx, "GET", endpoint, nil)
		if e == nil {
			if response, err := client.Do(req); err == nil {
				amount, source = parseNativePrice(response, i == 0)
				response.Body.Close()
			}
		}
		stop()
		if amount != "" {
			break
		}
	}
	if amount == "" {
		return
	}
	now := time.Now().UTC()
	expires := now.Add(20 * time.Minute)
	r := &displayprice.Reference{Target: displayprice.Target{ChainID: p.Chain, Token: zero}, Source: source, Status: "available", Unit: "USD_PER_WHOLE_TOKEN", BidUSD: &amount, AskUSD: &amount, AsOf: &now, ExpiresAt: &expires}
	p.mu.Lock()
	p.native = r
	p.mu.Unlock()
	p.persistPrices(ctx)
}

func parseNativePrice(response *http.Response, coinbase bool) (string, string) {
	if response == nil || response.StatusCode != http.StatusOK {
		return "", ""
	}
	if coinbase {
		var body struct {
			Data struct{ Base, Currency, Amount string }
		}
		if json.NewDecoder(io.LimitReader(response.Body, 16384)).Decode(&body) != nil || body.Data.Base != "ETH" || body.Data.Currency != "USD" {
			return "", ""
		}
		if validPositiveAmount(body.Data.Amount) {
			return body.Data.Amount, "coinbase_spot"
		}
		return "", ""
	}
	var body struct {
		Error  []string `json:"error"`
		Result map[string]struct {
			C []string `json:"c"`
		} `json:"result"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 16384)).Decode(&body) != nil || len(body.Error) != 0 {
		return "", ""
	}
	for pair, ticker := range body.Result {
		if pair != "XETHZUSD" && pair != "ETHUSD" {
			continue
		}
		if len(ticker.C) > 0 && validPositiveAmount(ticker.C[0]) {
			return ticker.C[0], "kraken_ticker"
		}
	}
	return "", ""
}

var nativeUSDDecimal = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)?$`)

func validPositiveAmount(amount string) bool {
	if len(amount) > 80 || !nativeUSDDecimal.MatchString(amount) {
		return false
	}
	n, ok := new(big.Rat).SetString(amount)
	return ok && n.Sign() > 0 && len(amount) <= 80
}
