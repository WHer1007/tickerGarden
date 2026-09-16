package demandevents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"tickergarden/backend/internal/deployment"
	"time"
)

type ProtocolSnapshot struct {
	SchemaVersion     int                          `json:"schemaVersion,omitempty"`
	TradingFees       map[string]string            `json:"tradingFees,omitempty"`
	FeeBasis          string                       `json:"feeBasis,omitempty"`
	ChainID           uint64                       `json:"chainId"`
	DisplayOnly       bool                         `json:"displayOnly"`
	ObservedAt        int64                        `json:"observedAt"`
	StockAmounts      map[string]string            `json:"stockAmounts"`
	StakingObservedAt int64                        `json:"stakingObservedAt"`
	FeeDecimals       map[string]uint8             `json:"feeDecimals"`
	StakingWallets    *int                         `json:"stakingWallets"`
	FeeCoverage       bool                         `json:"feeCoverage"`
	FeeAssets         map[string]map[string]string `json:"feeAssets"`
	FeeTotals         map[string]string            `json:"feeTotals"`
	WindowFrom        int64                        `json:"windowFrom"`
	Reason            string                       `json:"reason,omitempty"`
}

// Statistics read only durable project events. State checks use one shared block;
// callers never wait for RPC and cannot trigger more than one refresh at a time.
func (s *Service) ProtocolHandler() http.Handler {
	var mu sync.Mutex
	var cached *ProtocolSnapshot
	var saved []byte
	if s.Pool.QueryRow(s.ctx, `SELECT snapshot FROM tickergarden.display_snapshots WHERE scope_id=$1 AND name='protocol'`, s.Default.ID).Scan(&saved) == nil {
		var value ProtocolSnapshot
		if json.Unmarshal(saved, &value) == nil && value.ChainID == s.Default.ChainID && value.DisplayOnly {
			if value.SchemaVersion < 2 {
				value.FeeCoverage = false
			}
			cached = &value
		}
	}
	busy := false
	var attempted time.Time
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		mu.Lock()
		if !busy && time.Since(attempted) > time.Minute && (cached == nil || !cached.FeeCoverage || cached.StakingWallets == nil || time.Since(time.Unix(cached.ObservedAt, 0)) >= 10*time.Minute) {
			busy = true
			attempted = time.Now()
			go func() {
				ctx, cancel := context.WithTimeout(s.ctx, 60*time.Second)
				defer cancel()
				result, err := s.protocol(ctx)
				mu.Lock()
				defer mu.Unlock()
				busy = false
				if err == nil {
					cached = &result
					if raw, e := json.Marshal(result); e == nil {
						_, _ = s.Pool.Exec(ctx, `INSERT INTO tickergarden.display_snapshots(scope_id,name,snapshot) VALUES($1,'protocol',$2) ON CONFLICT(scope_id,name) DO UPDATE SET snapshot=excluded.snapshot,updated_at=clock_timestamp()`, s.Default.ID, raw)
					}
				}
			}()
		}
		result := cached
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if result == nil {
			json.NewEncoder(w).Encode(ProtocolSnapshot{ChainID: s.Default.ChainID, DisplayOnly: true, Reason: "statistics_pending", FeeAssets: map[string]map[string]string{}})
			return
		}
		view := protocolView(*result, time.Now())
		json.NewEncoder(w).Encode(view)
	})
}

// Never expose an expired count or a partial fee window as current statistics.
// Keep raw asset totals separate: adding ETH and Stock quantities is meaningless.
func protocolView(v ProtocolSnapshot, now time.Time) ProtocolSnapshot {
	v.FeeTotals = map[string]string{}
	v.WindowFrom = v.ObservedAt - 86400
	if v.WindowFrom < 0 {
		v.WindowFrom = 0
	}
	if v.StakingObservedAt <= 0 || now.Unix()-v.StakingObservedAt >= 1200 || v.StakingObservedAt > now.Unix() {
		v.StakingWallets = nil
	}
	if v.ObservedAt <= 0 || now.Unix()-v.ObservedAt >= 1200 || v.ObservedAt > now.Unix() {
		v.FeeCoverage = false
	}
	if v.FeeCoverage {
		for asset, buckets := range v.FeeAssets {
			total := new(big.Int)
			for _, key := range []string{"creator", "staker", "holder", "platform"} {
				n, ok := new(big.Int).SetString(buckets[key], 10)
				if !ok || n.Sign() < 0 {
					v.FeeCoverage = false
					break
				}
				total.Add(total, n)
			}
			v.FeeTotals[asset] = total.String()
		}
	}
	if v.FeeBasis == "TRADE_TIME" && v.FeeCoverage {
		v.FeeTotals = v.TradingFees
	}
	if !v.FeeCoverage {
		v.FeeTotals = map[string]string{}
	}
	if !v.FeeCoverage || v.StakingWallets == nil {
		v.Reason = "statistics_pending"
	}
	return v
}
func (s *Service) protocol(ctx context.Context) (ProtocolSnapshot, error) {
	out := ProtocolSnapshot{SchemaVersion: 2, ChainID: s.Default.ChainID, DisplayOnly: true, ObservedAt: time.Now().Unix(), FeeAssets: map[string]map[string]string{}, StockAmounts: map[string]string{}, FeeDecimals: map[string]uint8{}}
	caller, ok := s.Source.(interface {
		CallAt(context.Context, string, string, string) ([]byte, error)
	})
	if !ok {
		return out, errors.New("state reader missing")
	}
	head, e := s.Source.Header(ctx, "latest")
	if e != nil {
		return out, e
	}
	now, e := head.Time()
	if e != nil {
		return out, e
	}
	out.StakingObservedAt = int64(now)
	cutoff := uint64(0)
	if now > 86400 {
		cutoff = now - 86400
	}
	vault, registry, feeVault := "", "", ""
	for address, module := range s.Default.Modules {
		switch module {
		case "UserStockVault":
			vault = address
		case "OfficialStockRegistryV1":
			registry = address
		case "ProtocolFeeVault":
			feeVault = address
		}
	}
	call := func(address, method, args string) (*big.Int, error) {
		raw, e := caller.CallAt(ctx, address, deployment.Hash([]byte(method))[:10]+args, head.Hash)
		if e != nil || len(raw) != 32 {
			return nil, errors.New("invalid statistics state")
		}
		return new(big.Int).SetBytes(raw), nil
	}
	// Candidates come from protocol-emitted allocation records. Count is exposed
	// only if all candidate balances sum exactly to each asset's on-chain total.
	rows, e := s.Pool.Query(ctx, `SELECT DISTINCT ON (e.payload->'event'->'args'->>'assetUid',e.payload->'event'->'args'->>'user') e.payload->'event'->'args'->>'assetUid',e.payload->'event'->'args'->>'user',e.payload->'event'->'args'->>'userTotalAllocated' FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes d USING(scope_id) WHERE e.scope_id=$1 AND e.block_number<=d.processed_through AND e.payload->'event'->>'emitter'=$2 AND (e.payload->'event'->>'signature' LIKE 'AllocationLocked(%' OR e.payload->'event'->>'signature' LIKE 'AllocationReleased(%') AND e.payload->'event'->'args'->>'userTotalAllocated' IS NOT NULL ORDER BY e.payload->'event'->'args'->>'assetUid',e.payload->'event'->'args'->>'user',e.block_number DESC,e.transaction_index DESC,e.log_index DESC`, s.Default.ID, vault)
	if e != nil {
		return out, e
	}
	candidates := map[string]map[string]bool{}
	balances := map[string]*big.Int{}
	for rows.Next() {
		var asset, user, balance *string
		if e = rows.Scan(&asset, &user, &balance); e != nil {
			rows.Close()
			return out, e
		}
		if asset != nil && user != nil && len(*asset) == 66 && len(*user) == 42 {
			if candidates[*asset] == nil {
				candidates[*asset] = map[string]bool{}
			}
			candidates[*asset][*user] = true
			if balance == nil {
				return out, errors.New("missing allocation balance")
			}
			amount, ok := new(big.Int).SetString(*balance, 10)
			if !ok || amount.Sign() < 0 {
				return out, errors.New("invalid allocation balance")
			}
			balances[*asset+*user] = amount
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	// Include every admitted Stock, including assets without allocation events.
	rows, e = s.Pool.Query(ctx, `SELECT DISTINCT e.payload->'event'->'args'->>'assetUid' FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes d USING(scope_id) WHERE d.chain_id=$1 AND e.block_number<=d.processed_through AND e.payload->'event'->>'emitter'=$2 AND e.payload->'event'->'args'->>'assetUid' IS NOT NULL`, s.Default.ChainID, registry)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var asset string
		if e = rows.Scan(&asset); e != nil {
			rows.Close()
			return out, e
		}
		if len(asset) == 66 && candidates[asset] == nil {
			candidates[asset] = map[string]bool{}
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	wallets := map[string]bool{}
	complete := len(candidates) > 0
	for asset, users := range candidates {
		total, e := call(vault, "totalAllocated(bytes32)", asset[2:])
		if e != nil {
			complete = false
			continue
		}
		out.StockAmounts[asset] = total.String()
		sum := new(big.Int)
		for user := range users {
			n := balances[asset+user]
			if n == nil {
				complete = false
				continue
			}
			sum.Add(sum, n)
			if n.Sign() > 0 {
				wallets[user] = true
			}
		}
		if sum.Cmp(total) != 0 {
			complete = false
		}
	}
	if complete {
		count := len(wallets)
		out.StakingWallets = &count
	}
	var start, processed uint64
	var at *time.Time
	if e = s.Pool.QueryRow(ctx, `SELECT start_block,processed_through,observed_at FROM tickergarden.demand_event_scopes WHERE scope_id=$1`, s.Default.ID).Scan(&start, &processed, &at); e != nil {
		return out, e
	}
	// Use one common execution window across the global queue and market ledgers.
	marketRegistry, factory := "", ""
	for a, m := range s.Default.Modules {
		if m == "MarketRegistryV1" {
			marketRegistry = a
		}
		if m == "TickerGardenFactoryV1" {
			factory = a
		}
	}
	var markets, indexed int
	var volumeThrough *uint64
	err := s.Pool.QueryRow(ctx, `SELECT count(*),count(v.market_id),min(v.through_block) FROM tickergarden.demand_event_records c LEFT JOIN tickergarden.market_volume_cursors v ON v.chain_id=$2 AND v.registry=$3 AND v.market_id=c.payload->'event'->'args'->>'marketId' AND v.version=2 WHERE c.scope_id=$1 AND c.block_number<=$4 AND c.payload->'event'->>'emitter'=$5 AND c.payload->'event'->>'signature' LIKE 'MarketCreated(%'`, s.Default.ID, s.Default.ChainID, marketRegistry, processed, factory).Scan(&markets, &indexed, &volumeThrough)
	if err != nil {
		return out, err
	}
	executionsComplete := markets == indexed
	if volumeThrough != nil && *volumeThrough < processed {
		processed = *volumeThrough
	}
	startHead, e := s.Source.Header(ctx, fmt.Sprintf("0x%x", start))
	if e != nil {
		return out, e
	}
	startTime, e := startHead.Time()
	if e != nil {
		return out, e
	}
	processedHead, err := s.Source.Header(ctx, fmt.Sprintf("0x%x", processed))
	if err != nil {
		return out, err
	}
	processedTime, err := processedHead.Time()
	if err != nil {
		return out, err
	}
	if processedTime > 86400 {
		cutoff = processedTime - 86400
	}
	out.ObservedAt = int64(processedTime)
	out.FeeCoverage = executionsComplete && processedTime <= now && now-processedTime < 1200 && startTime <= cutoff && at != nil && time.Since(*at) < 20*time.Minute
	rows, e = s.Pool.Query(ctx, `SELECT e.block_number,e.block_hash,e.payload->'event' FROM tickergarden.demand_event_records e WHERE e.scope_id=$1 AND e.block_number<=$2 AND e.payload->'event'->>'emitter'=$3 AND e.payload->'event'->>'signature' IN ('CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)','FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)','HolderFeesAccrued(bytes32,uint32,address,uint256)') ORDER BY e.block_number DESC`, s.Default.ID, processed, feeVault)
	if e != nil {
		return out, e
	}
	type row struct {
		number uint64
		hash   string
		raw    []byte
	}
	defer rows.Close()
	times := map[uint64]uint64{}
	for rows.Next() {
		var r row
		if e = rows.Scan(&r.number, &r.hash, &r.raw); e != nil {
			return out, e
		}
		ts, ok := times[r.number]
		if !ok {
			ts, e = s.eventTime(ctx, r.number, r.hash)
			if e != nil {
				out.FeeCoverage = false
				continue
			}
			times[r.number] = ts
		}
		if ts < cutoff {
			break
		}
		var event struct {
			Signature string
			Args      map[string]any
		}
		if json.Unmarshal(r.raw, &event) != nil {
			return out, errors.New("bad fee event")
		}
		asset, _ := event.Args["feeAsset"].(string)
		if asset == "" {
			asset, _ = event.Args["quoteAsset"].(string)
		}
		if len(asset) != 42 {
			return out, errors.New("invalid fee asset")
		}
		if out.FeeAssets[asset] == nil {
			out.FeeAssets[asset] = map[string]string{"creator": "0", "staker": "0", "holder": "0", "platform": "0"}
		}
		fields := map[string]string{"creator": "creatorAmount", "staker": "stakerAmount", "platform": "platformAmount"}
		if strings.HasPrefix(event.Signature, "HolderFeesAccrued(") {
			fields = map[string]string{"holder": "amount"}
		}
		for bucket, field := range fields {
			raw, exists := event.Args[field]
			if !exists {
				continue
			}
			str, ok := raw.(string)
			n, valid := new(big.Int).SetString(str, 10)
			if !ok || !valid || n.Sign() < 0 {
				return out, errors.New("invalid fee amount")
			}
			old, _ := new(big.Int).SetString(out.FeeAssets[asset][bucket], 10)
			out.FeeAssets[asset][bucket] = old.Add(old, n).String()
		}
	}

	if e = rows.Err(); e != nil {
		return out, e
	}
	rows.Close()
	out.TradingFees, e = s.tradingFees(ctx, processed, cutoff, feeVault)
	if e != nil {
		out.FeeCoverage = false
	} else {
		out.FeeBasis = "TRADE_TIME"
	}
	assets := map[string]bool{}
	for asset := range out.FeeAssets {
		assets[asset] = true
	}
	for asset := range out.TradingFees {
		assets[asset] = true
	}
	for asset := range assets {
		if asset == "0x0000000000000000000000000000000000000000" {
			out.FeeDecimals[asset] = 18
			continue
		}
		d, err := call(asset, "decimals()", "")
		if err != nil || !d.IsUint64() || d.Uint64() > 255 {
			out.FeeCoverage = false
			continue
		}
		out.FeeDecimals[asset] = uint8(d.Uint64())
	}
	return out, nil
}
