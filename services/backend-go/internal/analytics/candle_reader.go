package analytics

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

type CandleStore struct {
	pool     *pgxpool.Pool
	manifest deployment.Manifest
}

func NewCandleStore(pool *pgxpool.Pool, m deployment.Manifest) (*CandleStore, error) {
	if pool == nil {
		return nil, ErrCandles
	}
	if _, _, _, err := conversionManifest(m); err != nil {
		return nil, err
	}
	m.Contracts = append([]deployment.Contract{}, m.Contracts...)
	return &CandleStore{pool: pool, manifest: m}, nil
}
func (s *CandleStore) Candles(ctx context.Context, market string, from, to, interval uint64) (MarketCandles, error) {
	return LoadMarketCandles(ctx, s.pool, s.manifest, market, from, to, interval)
}

func (s *CandleStore) Trades(ctx context.Context, market string, from, to uint64, limit int, cursor string) (TradePage, error) {
	if limit < 1 || limit > 100 || len(cursor) > 2048 {
		return TradePage{}, ErrTradeCursor
	}
	data, err := LoadMarketTrades(ctx, s.pool, s.manifest, market, from, to)
	if err != nil {
		return TradePage{}, err
	}
	return PageTrades(s.manifest.ChainID, data, limit, cursor)
}

func (s *CandleStore) AssetStatistics(ctx context.Context, asset string, from, to uint64) (AssetStatistics, error) {
	return LoadAssetStatistics(ctx, s.pool, s.manifest, asset, from, to)
}

func (s *CandleStore) Holders(ctx context.Context, market string) (MarketHolders, error) {
	return LoadMarketHolders(ctx, s.pool, s.manifest, market)
}

func (s *CandleStore) HolderPage(ctx context.Context, market string, limit int, cursor string) (HolderPage, error) {
	if limit < 1 || limit > 100 || len(cursor) > 2048 {
		return HolderPage{}, ErrHolderCursor
	}
	data, err := s.Holders(ctx, market)
	if err != nil {
		return HolderPage{}, err
	}
	return PageHolders(s.manifest.ChainID, data, limit, cursor)
}

func (s *CandleStore) GlobalStatistics(ctx context.Context, from, to uint64) (GlobalStatistics, error) {
	return LoadGlobalStatistics(ctx, s.pool, s.manifest, from, to)
}

func (s *CandleStore) GlobalSeries(ctx context.Context, from, to, interval uint64) (GlobalFlowSeries, error) {
	return LoadGlobalFlowSeries(ctx, s.pool, s.manifest, from, to, interval)
}

func (s *CandleStore) GlobalHolders(ctx context.Context) (GlobalHolderCounts, error) {
	return LoadGlobalHolderCounts(ctx, s.pool, s.manifest)
}
