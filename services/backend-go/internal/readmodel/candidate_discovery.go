package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"reflect"
	"strconv"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

func (s *ObservationStore) candidateDiscoveries(ctx context.Context, tx pgx.Tx, end uint64) (map[string]deployment.MarketDiscovery, error) {
	bad := errors.New("candidate discovery source unavailable")
	rows, e := tx.Query(ctx, `SELECT d.market_id,d.block_hash,d.log_index,d.payload,b.number,l.payload FROM tickergarden.canonical_discovered_markets d JOIN tickergarden.chain_blocks b ON b.chain_id=d.chain_id AND b.hash=d.block_hash LEFT JOIN tickergarden.chain_logs l ON l.chain_id=d.chain_id AND l.block_hash=d.block_hash AND l.log_index=d.log_index WHERE d.chain_id=$1 AND b.number BETWEEN $2 AND $3 ORDER BY b.number,d.log_index LIMIT 1001`, s.ChainID, s.StartBlock, end)
	if e != nil {
		return nil, bad
	}
	defer rows.Close()
	result := map[string]deployment.MarketDiscovery{}
	size := 0
	for rows.Next() {
		var id, hash string
		var index, height uint64
		var data, rawLog []byte
		if rows.Scan(&id, &hash, &index, &data, &height, &rawLog) != nil {
			return nil, bad
		}
		size += len(data) + len(rawLog)
		var d deployment.MarketDiscovery
		var log chainrpc.Log
		if size > 64<<20 || len(result) >= 1000 || json.Unmarshal(data, &d) != nil || json.Unmarshal(rawLog, &log) != nil || d.MarketID != id || result[id].MarketID != "" || !reflect.DeepEqual(d.Source, log) || log.BlockHash != hash || log.BlockNumber != "0x"+strconv.FormatUint(height, 16) || log.LogIndex != "0x"+strconv.FormatUint(index, 16) || log.Removed {
			return nil, bad
		}
		result[id] = d
	}
	if rows.Err() != nil {
		return nil, bad
	}
	return result, nil
}

// The projector deliberately enriches MarketCreated with the Registry state at
// its creation block. Accept exactly that persisted discovery, never arbitrary
// supplied projection observations. This does not reauthenticate RPC code.
func verifyCandidateInputViews(input projection.Input, discoveries map[string]deployment.MarketDiscovery) error {
	bad := errors.New("candidate projection observation is not discovery-backed")
	decoded, e := events.Decode(input.Module, input.Log)
	if e != nil {
		return bad
	}
	if !strings.HasPrefix(decoded.Signature, "MarketCreated(") {
		if len(input.Observations) != 0 {
			return bad
		}
		return nil
	}
	id, ok := decoded.Args["marketId"].(string)
	if !ok {
		return bad
	}
	d, ok := discoveries[id]
	if !ok || !reflect.DeepEqual(d.Source, input.Log) || len(input.Observations) != 1 {
		return bad
	}
	observation := input.Observations[0]
	if observation.Kind != "market" || observation.Key != id || !reflect.DeepEqual(map[string]any(observation.Value), d.State) {
		return bad
	}
	for _, field := range []string{"assetUid", "memeToken", "curve", "gauge", "quoteAsset", "quoteAssetConfigId", "tickerGardenBaselineId", "launchTemplateId"} {
		if value, exists := decoded.Args[field]; exists && !reflect.DeepEqual(value, d.State[field]) {
			return bad
		}
	}
	return nil
}
