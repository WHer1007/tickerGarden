package httpapi

import (
	"context"

	"tickergarden/backend/internal/displayprice"
	"tickergarden/backend/internal/readmodel"
)

type MarketMetricsReader interface {
	MarketMetrics(context.Context, readmodel.Snapshot, []displayprice.Reference) (map[string]*readmodel.MarketMetricsReadModel, error)
}
