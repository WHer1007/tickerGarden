package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"tickergarden/backend/internal/analytics"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/marketstats"
	"tickergarden/backend/internal/tokendetail"
	"tickergarden/backend/internal/transactions"
	"tickergarden/backend/internal/useractivity"
	"time"

	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/demandevents"
	"tickergarden/backend/internal/displayprice"
	"tickergarden/backend/internal/eventfeed"
	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/projector"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/rewards"
)

type marketMetricsAdapter struct {
	store *analytics.CandleStore
	cache *marketstats.Service
}

func (a marketMetricsAdapter) MarketMetrics(ctx context.Context, snap readmodel.Snapshot, refs []displayprice.Reference) (map[string]*readmodel.MarketMetricsReadModel, error) {
	if a.cache == nil {
		return nil, errors.New("statistics cache unavailable")
	}
	ids := []string{}
	for _, m := range snap.Markets {
		ids = append(ids, m.MarketID)
	}
	a.cache.Touch(ids)
	cached := a.cache.Snapshot()
	out := map[string]*readmodel.MarketMetricsReadModel{}
	for _, m := range snap.Markets {
		if v, ok := cached[m.MarketID]; ok && v.Metrics != nil {
			out[m.MarketID] = v.Metrics
		} else {
			out[m.MarketID] = &readmodel.MarketMetricsReadModel{Status: "unavailable", Reason: "statistics_pending", MarketCapBasis: marketstats.Basis, VolumeBasis: "EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE", AsOfTimestamp: "0", WindowFromTimestamp: "0"}
		}
	}
	return out, nil
}

func RunAPI(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	var demandReader eventfeed.Reader
	var displayReader httpapi.DisplayPriceReader
	if path := os.Getenv("TG_DISPLAY_PRICES_CONFIG"); path != "" {
		service, e := displayprice.Load(path, cfg.ChainID)
		if e != nil {
			return errors.New("invalid TG_DISPLAY_PRICES_CONFIG")
		}
		priceCtx, stopPrices := context.WithCancel(ctx)
		defer stopPrices()
		go service.Run(priceCtx)
		displayReader = service
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel})).With("service", "api", "environment", cfg.Environment)
	var database httpapi.Pinger
	var reader readmodel.Reader
	var rewardReader rewards.Reader
	var activityReader httpapi.ActivityReader
	activityPath := os.Getenv("TG_USER_ACTIVITY_MANIFEST")
	if activityPath != "" && cfg.DatabaseURL == "" {
		return errors.New("activity API requires TG_DATABASE_URL")
	}
	var transactionReader httpapi.TransactionReader
	transactionPath := os.Getenv("TG_TRANSACTION_STATUS_MANIFEST")
	if transactionPath != "" && cfg.DatabaseURL == "" {
		return errors.New("transaction API requires TG_DATABASE_URL")
	}
	var candles *analytics.CandleStore
	var statistics *marketstats.Service
	analyticsPath := os.Getenv("TG_ANALYTICS_MANIFEST")
	if analyticsPath != "" && cfg.DatabaseURL == "" {
		return errors.New("analytics API requires TG_DATABASE_URL")
	}
	if cfg.DatabaseURL != "" {
		pool, err := postgres.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
		if err != nil {
			return err
		}
		defer pool.Close()
		if activityPath != "" {
			f, e := os.Open(activityPath)
			if e != nil {
				return errors.New("cannot open activity manifest")
			}
			data, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
			f.Close()
			if e != nil || len(data) > 1<<20 {
				return errors.New("cannot read activity manifest")
			}
			m, e := deployment.Parse(data)
			if e != nil || m.ChainID != cfg.ChainID {
				return errors.New("invalid activity manifest or chain mismatch")
			}
			startText := os.Getenv("TG_USER_ACTIVITY_START_BLOCK")
			start, e := strconv.ParseUint(startText, 10, 63)
			if e != nil || strconv.FormatUint(start, 10) != startText {
				return errors.New("TG_USER_ACTIVITY_START_BLOCK must be a canonical nonnegative integer")
			}
			sort.Slice(m.Contracts, func(i, j int) bool { return m.Contracts[i].Address < m.Contracts[j].Address })
			canonical, e := json.Marshal(m)
			if e != nil {
				return e
			}
			activityReader = &useractivity.Store{Pool: pool, ChainID: cfg.ChainID, GenesisHash: m.GenesisHash, ManifestHash: deployment.Hash(canonical), StartBlock: start}
		}
		if transactionPath != "" {
			f, e := os.Open(transactionPath)
			if e != nil {
				return errors.New("cannot open transaction manifest")
			}
			data, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
			f.Close()
			if e != nil || len(data) > 1<<20 {
				return errors.New("cannot read transaction manifest")
			}
			m, e := deployment.Parse(data)
			if e != nil || m.ChainID != cfg.ChainID {
				return errors.New("invalid transaction manifest or chain mismatch")
			}
			transactionRPC := os.Getenv("TG_TRANSACTION_RPC_URL")
			if transactionRPC == "" {
				transactionRPC = os.Getenv("TG_RPC_URL")
			}
			rpc, e := chainrpc.New(transactionRPC)
			if e != nil {
				return e
			}
			transactionDSN := os.Getenv("TG_TRANSACTION_DATABASE_URL")
			if transactionDSN == "" {
				transactionDSN = cfg.DatabaseURL
			}
			transactionPool, e := postgres.Open(ctx, transactionDSN, 2)
			if e != nil {
				return e
			}
			defer transactionPool.Close()
			transactionReader = &transactions.Service{Journal: &transactions.Store{Pool: transactionPool, ChainID: cfg.ChainID, GenesisHash: m.GenesisHash}, RPC: rpc, ChainID: cfg.ChainID, GenesisHash: m.GenesisHash}
		}
		if analyticsPath != "" {
			f, e := os.Open(analyticsPath)
			if e != nil {
				return errors.New("cannot open analytics manifest")
			}
			data, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
			f.Close()
			if e != nil {
				return errors.New("cannot read analytics manifest")
			}
			m, e := deployment.Parse(data)
			if e != nil || m.ChainID != cfg.ChainID {
				return errors.New("invalid analytics manifest or chain mismatch")
			}
			registry := ""
			for _, c := range m.Contracts {
				if c.Module == "MarketRegistryV1" {
					registry = c.Address
				}
			}
			if registry != "" {
				rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
				if e != nil {
					return e
				}
				priceService := marketstats.NewPrices(cfg.ChainID, displayReader)
				if path := os.Getenv("TG_STATISTICS_STOCK_ROUTES"); path != "" {
					if e = priceService.LoadStockRoutes(path, rpc); e != nil {
						return e
					}
				}
				priceService.EnableCache(ctx, pool, registry)
				go priceService.Run(ctx)
				statistics, e = marketstats.New(ctx, pool, rpc, cfg.ChainID, registry, priceService)
				if e != nil {
					return e
				}
			}
			candles, e = analytics.NewCandleStore(pool, m)
			if e != nil {
				return e
			}
		}

		if mode := os.Getenv("TG_EVENT_READ_MODE"); mode == "on-demand" {
			raw, e := os.ReadFile(os.Getenv("TG_DEPLOYMENT_MANIFEST"))
			if e != nil {
				return errors.New("cannot read demand manifest")
			}
			m, e := deployment.Parse(raw)
			if e != nil || m.ChainID != cfg.ChainID {
				return errors.New("invalid demand manifest")
			}
			start, e := strconv.ParseUint(os.Getenv("TG_EVENT_START_BLOCK"), 10, 64)
			if e != nil || start == 0 {
				return errors.New("TG_EVENT_START_BLOCK required")
			}
			rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
			if e != nil {
				return e
			}
			scope := demandevents.ScopeFromManifest(m, start)
			if os.Getenv("TG_EVENT_START_POLICY") == "latest-on-first-request" {
				scope.FromHead = true
				scope.ID += ":head"
			}
			demandReader, e = demandevents.New(ctx, pool, rpc, scope)
			if e != nil {
				return e
			}
		} else if mode != "" && mode != "journal" {
			return errors.New("invalid TG_EVENT_READ_MODE")
		}
		database = pool
		reader = &readmodel.Store{Pool: pool, ChainID: cfg.ChainID}
		rewardReader = &rewards.Store{Pool: pool, ChainID: cfg.ChainID, Version: projector.Version, Scope: projector.ObservationScope}
	}
	var candleReader httpapi.CandleReader
	var tradeReader httpapi.TradeReader
	var holderReader httpapi.HolderReader
	var globalReader httpapi.GlobalStatisticsReader
	var seriesReader httpapi.GlobalSeriesReader
	var globalHolderReader httpapi.GlobalHolderReader
	var assetStatisticsReader httpapi.AssetStatisticsReader
	var marketMetricsReader httpapi.MarketMetricsReader
	if candles != nil {
		candleReader = candles
		tradeReader = candles
		holderReader = candles
		globalReader = candles
		seriesReader = candles
		globalHolderReader = candles
		assetStatisticsReader = candles
		marketMetricsReader = marketMetricsAdapter{store: candles, cache: statistics}
	}
	detailReader := &tokendetail.Service{ChainID: cfg.ChainID, Models: reader}
	if candles != nil {
		detailReader.History = candles
	}
	dune, e := tokendetail.ConfiguredDune(os.Getenv("TG_TOKEN_DETAIL_SOURCE"), os.Getenv("TG_DUNE_DETAIL_QUERY_ID"), os.Getenv("TG_DUNE_API_KEY"))
	if e != nil {
		return e
	}
	if dune != nil {
		detailReader.Dune = dune
	}
	server := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.New(httpapi.Options{MarketStatistics: statistics, EventFeed: demandReader, TokenDetail: detailReader, Activities: activityReader, Transactions: transactionReader, GlobalHolders: globalHolderReader, GlobalSeries: seriesReader, GlobalStatistics: globalReader, Holders: holderReader, AssetStatistics: assetStatisticsReader, Candles: candleReader, Trades: tradeReader, DisplayPrices: displayReader, MarketMetrics: marketMetricsReader, Logger: logger, Database: database, ReadModels: reader, Rewards: rewardReader, ChainID: cfg.ChainID,
			AllowedOrigin: cfg.AllowedOrigin, ProbeTimeout: cfg.ProbeTimeout}),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 15 * time.Second, IdleTimeout: time.Minute, MaxHeaderBytes: 16 << 10,
		BaseContext: func(net.Listener) context.Context { return ctx },
		ErrorLog:    slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}
	listener, err := net.Listen("tcp", cfg.HTTPAddr)
	if err != nil {
		return errors.New("cannot bind API listen address")
	}
	logger.Info("api_started", "address", listener.Addr().String(), "chain_id", cfg.ChainID, "stage", "read-api", "database_configured", database != nil)
	return Serve(ctx, server, listener, cfg.ShutdownTimeout)
}

// Serve owns listener shutdown, including the forced-close fallback on timeout.
func Serve(ctx context.Context, server *http.Server, listener net.Listener, timeout time.Duration) error {
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	select {
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return errors.New("API server stopped unexpectedly")
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			<-done
			return errors.New("API graceful shutdown timed out")
		}
		<-done
		return nil
	}
}
