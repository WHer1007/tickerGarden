package marketstats

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"os"
	"regexp"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/displayprice"
	"time"
)

type stockRoute struct {
	TokenIn, TokenOut, Pool, Symbol string
	Decimals                        uint8
}

// LoadStockRoutes accepts the saved testnet purchase pools. Mainnet must use
// its own verified USD provider; testnet pool prices are not NYSE stock quotes.
func (p *PriceService) LoadStockRoutes(path string, rpc RPC) error {
	f, e := os.Open(path)
	if e != nil {
		return errors.New("stock price routes unavailable")
	}
	defer f.Close()
	var manifest struct {
		ChainID       uint64
		WrappedNative string
		Routes        []stockRoute
	}
	if json.NewDecoder(io.LimitReader(f, 65536)).Decode(&manifest) != nil || manifest.ChainID != 46630 || p.Chain != 46630 || len(manifest.Routes) > 64 {
		return errors.New("invalid testnet stock price routes")
	}
	address := regexp.MustCompile(`^0x[0-9a-f]{40}$`)
	p.stockRoutes = map[string]stockRoute{}
	p.stockRefs = map[string]displayprice.Reference{}
	p.stockAttempts = map[string]time.Time{}
	p.stockRPC = rpc
	for _, route := range manifest.Routes {
		route.TokenIn = strings.ToLower(route.TokenIn)
		route.TokenOut = strings.ToLower(route.TokenOut)
		route.Pool = strings.ToLower(route.Pool)
		if !address.MatchString(route.TokenIn) || !address.MatchString(route.TokenOut) || !address.MatchString(route.Pool) || route.TokenIn != strings.ToLower(manifest.WrappedNative) || route.Decimals != 18 || route.TokenIn == route.TokenOut {
			return errors.New("invalid stock price pool binding")
		}
		if _, ok := p.stockRoutes[route.TokenOut]; ok {
			return errors.New("duplicate stock price pool")
		}
		p.stockRoutes[route.TokenOut] = route
	}
	return nil
}

// RefreshStocks is invoked only by an active statistics worker, once per
// requested quote asset every 20 minutes. Five projects sharing TSLA share one
// slot0 read. Token ordering is verified once from the configured V3 pool.
func (p *PriceService) RefreshStocks(ctx context.Context, quotes []string, head chainrpc.Header) {
	changed := false
	defer func() {
		if changed {
			p.persistPrices(ctx)
		}
	}()
	if p.stockRPC == nil {
		return
	}
	p.mu.RLock()
	native := p.native
	p.mu.RUnlock()
	now := time.Now().UTC()
	if native == nil || native.ExpiresAt == nil || !now.Before(*native.ExpiresAt) {
		return
	}
	eth, ok := new(big.Rat).SetString(*native.BidUSD)
	if !ok {
		return
	}
	for _, quote := range quotes {
		route, ok := p.stockRoutes[quote]
		if !ok || now.Before(p.stockAttempts[quote]) {
			continue
		}
		p.stockAttempts[quote] = now.Add(time.Minute)
		call := func(method string) ([]byte, error) {
			return p.stockRPC.CallAt(ctx, route.Pool, deployment.Hash([]byte(method))[:10], head.Hash)
		}
		p.mu.RLock()
		_, verified := p.stockRefs[quote]
		p.mu.RUnlock()
		if !verified {
			a, e := call("token0()")
			if e != nil || len(a) != 32 {
				continue
			}
			b, e := call("token1()")
			if e != nil || len(b) != 32 {
				continue
			}
			first, second := route.TokenIn, route.TokenOut
			if first > second {
				first, second = second, first
			}
			if "0x"+hex.EncodeToString(a[12:]) != first || "0x"+hex.EncodeToString(b[12:]) != second {
				continue
			}
		}
		raw, e := call("slot0()")
		if e != nil || len(raw) != 224 {
			continue
		}
		ratio, e := Spot(new(big.Int).SetBytes(raw[:32]), quote < route.TokenIn, 18)
		if e != nil {
			continue
		}
		price, ok := new(big.Rat).SetString(ratio)
		if !ok {
			continue
		}
		amount := price.Mul(price, eth).FloatString(18)
		expires := now.Add(20 * time.Minute)
		ref := displayprice.Reference{Target: displayprice.Target{ChainID: p.Chain, Token: quote, Symbol: route.Symbol}, Source: "testnet_pool_spot", Unit: "USD_PER_WHOLE_TOKEN", Status: "available", BidUSD: &amount, AskUSD: &amount, AsOf: &now, ExpiresAt: &expires, RetrievedAt: now}
		p.mu.Lock()
		p.stockRefs[quote] = ref
		changed = true
		p.mu.Unlock()
		p.stockAttempts[quote] = now.Add(20 * time.Minute)
	}
}
