package analytics

import (
	"context"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

type GlobalFlowGroup struct {
	AssetUID               string          `json:"assetUid"`
	Binding                string          `json:"binding"`
	QuoteAsset             string          `json:"quoteAsset"`
	QuoteDecimals          uint8           `json:"quoteDecimals"`
	TradeCount             uint64          `json:"tradeCount"`
	InternalTradeCount     uint64          `json:"internalTradeCount"`
	UnclassifiedTradeCount uint64          `json:"unclassifiedTradeCount"`
	QuoteVolumeRaw         string          `json:"quoteVolumeRaw"`
	InternalQuoteVolumeRaw string          `json:"internalQuoteVolumeRaw"`
	Fees                   []AssetFeeTotal `json:"fees"`
	UnknownFeeTradeCount   uint64          `json:"unknownFeeTradeCount"`
}
type GlobalFlowPoint struct {
	Timestamp uint64            `json:"timestamp"`
	Groups    []GlobalFlowGroup `json:"groups"`
}
type GlobalFlowSeries struct {
	Coverage    RangeCoverage     `json:"coverage"`
	Interval    uint64            `json:"interval"`
	VolumeBasis string            `json:"volumeBasis"`
	EmptyPolicy string            `json:"emptyPolicy"`
	Points      []GlobalFlowPoint `json:"points"`
}

func validGlobalSeriesRange(from, to, interval uint64) bool {
	switch interval {
	case 60, 300, 900, 3600, 14400, 86400:
	default:
		return false
	}
	return from < to && to <= math.MaxInt64 && from%interval == 0 && to%interval == 0 && (to-from)/interval <= 2000
}

// BuildGlobalFlowSeries uses complete authenticated market inputs for the whole
// range. No balance, reserve, historical market count or price is inferred.
func BuildGlobalFlowSeries(chain uint64, coverage RangeCoverage, interval uint64, inputs []AssetMarketTrades) (GlobalFlowSeries, error) {
	fail := func() (GlobalFlowSeries, error) { return GlobalFlowSeries{}, ErrAssetStats }
	if chain == 0 || !validGlobalSeriesRange(coverage.From, coverage.To, interval) {
		return fail()
	}
	buckets := int((coverage.To - coverage.From) / interval)
	if len(inputs) > 1000 || len(inputs)*buckets > 100000 {
		return fail()
	}
	if _, err := AggregateAssetTrades(chain, coverage, inputs); err != nil {
		return fail()
	}
	partition := make([][][]TradeActivity, len(inputs))
	for i, m := range inputs {
		partition[i] = make([][]TradeActivity, buckets)
		for _, t := range m.Trades.Items {
			ts, _ := strconv.ParseUint(t.Timestamp, 10, 64)
			b := (ts - coverage.From) / interval
			partition[i][b] = append(partition[i][b], t)
		}
	}
	out := GlobalFlowSeries{Coverage: coverage, Interval: interval, VolumeBasis: "CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE", EmptyPolicy: "ZERO_FLOW_NO_SYNTHETIC_EXECUTIONS", Points: make([]GlobalFlowPoint, 0, buckets)}
	zero := "0x" + strings.Repeat("0", 64)
	for b := 0; b < buckets; b++ {
		from := coverage.From + uint64(b)*interval
		rangeCoverage := coverage
		rangeCoverage.From = from
		rangeCoverage.To = from + interval
		selected := make([]AssetMarketTrades, len(inputs))
		for i, m := range inputs {
			selected[i] = m
			selected[i].Trades.Coverage = rangeCoverage
			selected[i].Trades.Items = partition[i][b]
		}
		groups, err := AggregateAssetTrades(chain, rangeCoverage, selected)
		if err != nil {
			return fail()
		}
		point := GlobalFlowPoint{Timestamp: from, Groups: []GlobalFlowGroup{}}
		for _, g := range groups {
			binding := "registered_stock"
			if g.AssetUID == zero {
				binding = "unbound"
			}
			point.Groups = append(point.Groups, GlobalFlowGroup{g.AssetUID, binding, g.QuoteAsset, g.QuoteDecimals, g.TradeCount, g.InternalTradeCount, g.UnclassifiedTradeCount, g.QuoteVolumeRaw, g.InternalQuoteVolumeRaw, g.Fees, g.UnknownFeeTradeCount})
		}
		out.Points = append(out.Points, point)
	}
	return out, nil
}
func LoadGlobalFlowSeries(ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, from, to, interval uint64) (GlobalFlowSeries, error) {
	if !validGlobalSeriesRange(from, to, interval) {
		return GlobalFlowSeries{}, ErrAssetStats
	}
	stats, inputs, err := loadGlobalSnapshot(ctx, pool, m, from, to)
	if err != nil {
		return GlobalFlowSeries{}, err
	}
	return BuildGlobalFlowSeries(m.ChainID, stats.Coverage, interval, inputs)
}
