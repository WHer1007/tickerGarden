package main

import (
	"context"
	"errors"
	"reflect"
	"strconv"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func verifyCandidateRoutes(ctx context.Context, rpc deployment.BindingObserver, m deployment.Manifest, c readmodel.CandidateSet) error {
	bad := errors.New("candidate market route RPC mismatch")
	if len(c.Markets) > 1000 {
		return bad
	}
	n, e := readmodel.Height(c.BlockNumber)
	if e != nil {
		return bad
	}
	block, e := rpc.Header(ctx, "0x"+strconv.FormatUint(n, 16))
	if e != nil || block.Hash != c.BlockHash {
		return bad
	}
	seen := map[string]bool{}
	for _, market := range c.Markets {
		if seen[market.MarketID] {
			return bad
		}
		seen[market.MarketID] = true
		batch, e := deployment.ObserveMarketRoute(ctx, rpc, m, block, market.MarketID)
		if e != nil || batch.ChainID != c.ChainID || batch.BlockHash != c.BlockHash || batch.BlockNumber != block.Number || matchCandidateRoute(market, batch) != nil {
			return bad
		}
	}
	return nil
}

func matchCandidateRoute(m readmodel.MarketReadModel, b deployment.ObservationBatch) error {
	bad := errors.New("candidate route fields differ from RPC")
	if b.Scope != "market-route-v1" || b.Expected != len(b.Observations) {
		return bad
	}
	rows := map[string]map[string]any{}
	for _, o := range b.Observations {
		key := o.Kind + ":" + o.Key
		if _, ok := rows[key]; ok {
			return bad
		}
		rows[key] = o.Value
	}
	route := rows["canonicalRoute:"+m.MarketID]
	pool := rows["poolKey:"+m.MarketID]
	if route == nil || pool == nil {
		return bad
	}
	r := m.CanonicalRoute
	for field, want := range map[string]any{"memeToken": m.MemeToken, "quoteAsset": m.QuoteAsset, "curve": m.Curve, "gauge": m.Gauge, "swapRouter": r.Router, "quoter": r.Quoter, "hook": r.Hook, "launchLocker": r.LaunchLocker, "graduationExecutor": r.GraduationExecutor, "curveTradingEnabled": r.CurveTradingEnabled, "poolTradingEnabled": r.PoolTradingEnabled, "sourceVersion": strconv.FormatUint(m.SourceVersion, 10), "launchPhase": strconv.FormatUint(m.LaunchPhase, 10)} {
		if !reflect.DeepEqual(route[field], want) {
			return bad
		}
	}
	if r.SourceVersion != m.SourceVersion || r.LaunchPhase != m.LaunchPhase {
		return bad
	}
	if m.LaunchPhase == 0 {
		if m.PoolID != nil || m.PoolKey != nil {
			return bad
		}
		return nil
	}
	if m.LaunchPhase != 1 || m.PoolID == nil || m.PoolKey == nil || route["poolId"] != *m.PoolID {
		return bad
	}
	p := m.PoolKey
	for field, want := range map[string]any{"currency0": p.Currency0, "currency1": p.Currency1, "fee": strconv.FormatUint(p.Fee, 10), "tickSpacing": strconv.FormatInt(p.TickSpacing, 10), "hooks": p.Hooks} {
		if !reflect.DeepEqual(pool[field], want) {
			return bad
		}
	}
	return nil
}
