package marketstats

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"math/big"
	"tickergarden/backend/internal/displayprice"
	"time"
)

func (p *PriceService) priceScope(ctx context.Context) string {
	var scope string
	if p.cachePool != nil {
		_ = p.cachePool.QueryRow(ctx, `SELECT scope_id FROM tickergarden.demand_event_scopes WHERE chain_id=$1 AND config->'modules'->>$2='MarketRegistryV1' ORDER BY start_block DESC LIMIT 1`, p.Chain, p.cacheRegistry).Scan(&scope)
	}
	return scope
}
func usableCachedPrice(r displayprice.Reference, chain uint64, now time.Time) bool {
	if r.ChainID != chain || r.Status != "available" || r.Unit != "USD_PER_WHOLE_TOKEN" || r.AsOf == nil || r.ExpiresAt == nil || r.AsOf.After(now) || !r.ExpiresAt.After(now) || r.ExpiresAt.Sub(*r.AsOf) > 20*time.Minute || r.BidUSD == nil || r.AskUSD == nil {
		return false
	}
	bid, a := new(big.Rat).SetString(*r.BidUSD)
	ask, b := new(big.Rat).SetString(*r.AskUSD)
	return a && b && bid.Sign() > 0 && ask.Cmp(bid) >= 0
}

// Configure before Run. A cached quote retains its original expiry after restart.
func (p *PriceService) EnableCache(ctx context.Context, pool *pgxpool.Pool, registry string) {
	p.cachePool = pool
	p.cacheRegistry = registry
	scope := p.priceScope(ctx)
	if scope == "" {
		return
	}
	var raw []byte
	if pool.QueryRow(ctx, `SELECT snapshot FROM tickergarden.display_snapshots WHERE scope_id=$1 AND name='usd-prices'`, scope).Scan(&raw) != nil {
		return
	}
	var refs []displayprice.Reference
	if json.Unmarshal(raw, &refs) != nil {
		return
	}
	now := time.Now()
	for _, r := range refs {
		if !usableCachedPrice(r, p.Chain, now) {
			continue
		}
		if r.Token == zero && r.Source == "coinbase_spot" {
			value := r
			p.native = &value
		} else if _, ok := p.stockRoutes[r.Token]; ok && r.Source == "testnet_pool_spot" {
			p.stockRefs[r.Token] = r
		}
	}
}
func (p *PriceService) persistPrices(ctx context.Context) {
	scope := p.priceScope(ctx)
	if scope == "" {
		return
	}
	raw, err := json.Marshal(p.Read(time.Now()))
	if err != nil {
		return
	}
	_, _ = p.cachePool.Exec(ctx, `INSERT INTO tickergarden.display_snapshots(scope_id,name,snapshot) VALUES($1,'usd-prices',$2) ON CONFLICT(scope_id,name) DO UPDATE SET snapshot=excluded.snapshot,updated_at=clock_timestamp()`, scope, raw)
}
