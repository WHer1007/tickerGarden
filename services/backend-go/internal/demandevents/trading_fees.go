package demandevents

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
)

// Trading fees follow execution time. Curve sweeps only identify the source of
// adjacent Holder credits; they must never count old curve fees as new revenue.
func (s *Service) tradingFees(ctx context.Context, through, cutoff uint64, vault string) (map[string]string, error) {
	factory := ""
	for a, m := range s.Default.Modules {
		if m == "TickerGardenFactoryV1" {
			factory = a
		}
	}
	rows, err := s.Pool.Query(ctx, `SELECT e.block_number,e.block_hash,e.payload->>'transactionHash',e.payload->'event',c.payload->'event'->'args'->>'quoteAsset'
 FROM tickergarden.demand_event_records e LEFT JOIN tickergarden.demand_event_records c ON c.scope_id=e.scope_id AND c.block_number<=$2 AND c.payload->'event'->>'emitter'=$4 AND c.payload->'event'->>'signature' LIKE 'MarketCreated(%' AND c.payload->'event'->'args'->>'curve'=e.payload->'event'->>'emitter'
 WHERE e.scope_id=$1 AND e.block_number<=$2 AND ((e.payload->'event'->>'emitter'=$3 AND (e.payload->'event'->>'signature' LIKE 'FeeBucketsCredited(%' OR e.payload->'event'->>'signature' LIKE 'CurveFeesSwept(%' OR e.payload->'event'->>'signature' LIKE 'HolderFeesAccrued(%')) OR (c.block_number IS NOT NULL AND (e.payload->'event'->>'signature' LIKE 'CurveBuy(%' OR e.payload->'event'->>'signature' LIKE 'CurveSell(%'))) ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC`, s.Default.ID, through, vault, factory)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	total := map[string]string{}
	sources := map[string]bool{}
	for rows.Next() {
		var n uint64
		var hash, tx string
		var raw []byte
		var quote *string
		if err = rows.Scan(&n, &hash, &tx, &raw, &quote); err != nil {
			return nil, err
		}
		at, err := s.eventTime(ctx, n, hash)
		if err != nil {
			return nil, err
		}
		if at < cutoff {
			break
		}
		var event struct {
			Signature string
			Args      map[string]any
		}
		if json.Unmarshal(raw, &event) != nil {
			return nil, errors.New("invalid trading fee event")
		}
		asset, _ := event.Args["feeAsset"].(string)
		if asset == "" {
			asset, _ = event.Args["quoteAsset"].(string)
		}
		market, _ := event.Args["marketId"].(string)
		key := tx + market + asset
		fields := []string{}
		switch {
		case strings.HasPrefix(event.Signature, "CurveFeesSwept("):
			sources[key] = false
			continue
		case strings.HasPrefix(event.Signature, "FeeBucketsCredited("):
			sources[key] = true
			fields = []string{"creatorAmount", "stakerAmount", "platformAmount"}
		case strings.HasPrefix(event.Signature, "HolderFeesAccrued("):
			pool, exists := sources[key]
			if !exists {
				return nil, errors.New("unpaired holder credit")
			}
			delete(sources, key)
			if !pool {
				continue
			}
			fields = []string{"amount"}
		default:
			if quote == nil {
				return nil, errors.New("missing curve quote")
			}
			asset = *quote
			fields = []string{"fee", "tax"}
		}
		if len(asset) != 42 {
			return nil, errors.New("invalid trading fee asset")
		}
		sum := new(big.Int)
		if total[asset] != "" {
			sum.SetString(total[asset], 10)
		}
		for _, field := range fields {
			raw, ok := event.Args[field].(string)
			amount, valid := new(big.Int).SetString(raw, 10)
			if !ok || !valid || amount.Sign() < 0 {
				return nil, errors.New("invalid trading fee amount")
			}
			sum.Add(sum, amount)
		}
		total[asset] = sum.String()
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	registry := ""
	for a, m := range s.Default.Modules {
		if m == "MarketRegistryV1" {
			registry = a
		}
	}
	// Child scopes are demand-driven and may not have been opened. The shared
	// execution ledger covers curve fees independently of those child queues.
	rows, err = s.Pool.Query(ctx, `SELECT c.payload->'event'->'args'->>'quoteAsset',sum(v.curve_fee)::text FROM tickergarden.market_volume_events v JOIN tickergarden.demand_event_records c ON c.scope_id=$1 AND c.payload->'event'->>'emitter'=$2 AND c.payload->'event'->>'signature' LIKE 'MarketCreated(%' AND c.payload->'event'->'args'->>'marketId'=v.market_id AND c.block_number<=$3 WHERE v.chain_id=$4 AND v.registry=$5 AND v.block_number<=$3 AND v.block_time>=$6 AND v.curve_fee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tickergarden.demand_event_records existing WHERE existing.scope_id=$1 AND existing.payload->>'transactionHash'=v.transaction_hash AND existing.log_index=v.log_index AND (existing.payload->'event'->>'signature' LIKE 'CurveBuy(%' OR existing.payload->'event'->>'signature' LIKE 'CurveSell(%')) GROUP BY 1`, s.Default.ID, factory, through, s.Default.ChainID, registry, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var asset, raw string
		if err = rows.Scan(&asset, &raw); err != nil {
			return nil, err
		}
		n, ok := new(big.Int).SetString(raw, 10)
		if !ok || n.Sign() < 0 || len(asset) != 42 {
			return nil, errors.New("invalid cached curve fee")
		}
		old := new(big.Int)
		if total[asset] != "" {
			old.SetString(total[asset], 10)
		}
		total[asset] = old.Add(old, n).String()
	}
	return total, rows.Err()
}
