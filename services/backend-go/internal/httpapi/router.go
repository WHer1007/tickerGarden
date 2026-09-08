// Package httpapi exposes the V1 read-only API and operational probes.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"tickergarden/backend/internal/eventfeed"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/rewards"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Pinger interface {
	Ping(context.Context) error
}

type Options struct {
	EventFeed        eventfeed.Reader
	TokenDetail      TokenDetailReader
	Activities       ActivityReader
	Transactions     TransactionReader
	GlobalHolders    GlobalHolderReader
	GlobalSeries     GlobalSeriesReader
	GlobalStatistics GlobalStatisticsReader
	Holders          HolderReader
	AssetStatistics  AssetStatisticsReader
	Trades           TradeReader
	Candles          CandleReader
	DisplayPrices    DisplayPriceReader
	MarketMetrics    MarketMetricsReader
	Rewards          rewards.Reader
	TreasuryProofs   TreasuryProofReader
	Logger           *slog.Logger
	Database         Pinger
	ReadModels       readmodel.Reader
	ChainID          uint64
	AllowedOrigin    string
	ProbeTimeout     time.Duration
}

func New(opts Options) http.Handler {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.ProbeTimeout <= 0 {
		opts.ProbeTimeout = 2 * time.Second
	}
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(accessLog(opts.Logger))
	metrics := newHTTPMetrics()
	r.Use(metrics.observe)
	r.Use(recoverPanic(opts.Logger))
	r.Use(cors(opts.AllowedOrigin))
	r.Get("/metrics", metrics.ServeHTTP)
	r.Get("/livez", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "alive"})
	})
	snapshotGate := snapshotCapacity(snapshotConcurrentRequests)
	r.HandleFunc("/health", snapshotGate(reads(opts)))
	r.Get("/readyz", snapshotGate(func(w http.ResponseWriter, r *http.Request) {
		database := "not_configured"
		if opts.Database != nil {
			ctx, cancel := context.WithTimeout(r.Context(), opts.ProbeTimeout)
			defer cancel()
			if err := opts.Database.Ping(ctx); err != nil {
				database = "unavailable"
			} else {
				database = "reachable"
			}
		}
		model := "unavailable"
		if opts.ReadModels != nil {
			ctx, cancel := context.WithTimeout(r.Context(), opts.ProbeTimeout)
			defer cancel()
			snapshot, err := opts.ReadModels.Load(ctx, "")
			if err == nil && snapshot.Sync.Status == "synced" {
				model = "ready"
			}
		}
		code, status := http.StatusServiceUnavailable, "not_ready"
		if database == "reachable" && model == "ready" {
			code, status = http.StatusOK, "ready"
		}
		writeJSON(w, code, map[string]any{"status": status, "checks": map[string]string{
			"database": database, "read_model": model, "publication": "trusted_snapshot",
		}})
	}))
	if opts.EventFeed != nil {
		r.Handle("/v1/events", http.StripPrefix("/v1", eventfeed.Handler(opts.EventFeed)))
	}
	analyticsGate := analyticsCapacity(analyticsConcurrentRequests)
	transactionGate := analyticsCapacity(transactionConcurrentRequests)
	r.HandleFunc("/v1/transactions/{txHash}", transactionGate(transactionReads(opts)))
	r.HandleFunc("/v1/users/{address}/activity", analyticsGate(activityReads(opts)))
	r.HandleFunc("/v1/markets/{marketId}/detail", analyticsGate(tokenDetailReads(opts)))
	r.HandleFunc("/v1/markets/{marketId}/trades", analyticsGate(tradeReads(opts)))
	r.HandleFunc("/v1/markets/{marketId}/holders", analyticsGate(holderReads(opts)))
	r.HandleFunc("/v1/assets/{assetUid}/statistics", analyticsGate(assetStatisticsReads(opts)))
	r.HandleFunc("/v1/stats/overview", analyticsGate(globalStatisticsReads(opts)))
	r.HandleFunc("/v1/stats/holders", analyticsGate(globalHolderReads(opts)))
	r.HandleFunc("/v1/stats/series", analyticsGate(globalSeriesReads(opts)))
	r.HandleFunc("/v1/markets/{marketId}/candles", analyticsGate(candleReads(opts)))
	r.HandleFunc("/v1/updates", snapshotGate(updates(opts)))
	r.HandleFunc("/v1/prices/references", displayPrices(opts))
	r.HandleFunc("/v1/users/{address}/rewards", rewardReads(opts))
	r.HandleFunc("/v1/treasury/*", treasuryProofs(opts))
	r.HandleFunc("/v1", snapshotGate(reads(opts)))
	r.HandleFunc("/v1/*", snapshotGate(reads(opts)))
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, http.StatusNotFound, "not_found", "route not found")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "GET, OPTIONS")
		writeError(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	})
	return r
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message, "requestId": middleware.GetReqID(r.Context())})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func accessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			wrapped.Header().Set("X-Request-ID", middleware.GetReqID(r.Context()))
			next.ServeHTTP(wrapped, r)
			// Query strings and headers can contain private data; never log them.
			logger.Info("http_request", "method", r.Method, "path", r.URL.Path,
				"status", wrapped.Status(), "duration_ms", time.Since(start).Milliseconds(),
				"request_id", middleware.GetReqID(r.Context()))
		})
	}
}

func recoverPanic(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if recover() != nil {
					logger.Error("http_handler_panic", "request_id", middleware.GetReqID(r.Context()))
					writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func cors(origin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Add("Vary", "Origin")
			if requested := r.Header.Get("Origin"); requested != "" {
				if origin == "" || requested != origin {
					writeError(w, r, http.StatusForbidden, "origin_not_allowed", "origin not allowed")
					return
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
			}
			if r.Method == http.MethodOptions {
				if r.Header.Get("Origin") == "" || r.Header.Get("Access-Control-Request-Method") != http.MethodGet {
					writeError(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "only GET preflights are supported")
					return
				}
				w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, X-Request-ID")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
