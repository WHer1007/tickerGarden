package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

// Like the projector, resolve registrations before processing a block's logs.
// Bindings still carry registration height: only same-block constructor events,
// never earlier-block events, can use a subsequently encountered registration.
func (s *ObservationStore) bindCandidateRegistrations(ctx context.Context, tx pgx.Tx, end uint64, b *candidateEmitterBindings) error {
	if b.registry == "" {
		return nil
	}
	bad := errors.New("candidate asset registration inventory invalid")
	rows, e := tx.Query(ctx, `SELECT l.payload FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks c ON c.chain_id=l.chain_id AND c.hash=l.block_hash WHERE l.chain_id=$1 AND l.address=$2 AND c.canonical AND c.receipts_verified AND c.number BETWEEN $3 AND $4 ORDER BY c.number,l.log_index LIMIT 100001`, s.ChainID, b.registry, s.StartBlock, end)
	if e != nil {
		return bad
	}
	defer rows.Close()
	count, size := 0, 0
	assets, tokens := map[string]bool{}, map[string]bool{}
	for rows.Next() {
		var raw []byte
		if rows.Scan(&raw) != nil {
			return bad
		}
		count++
		size += len(raw)
		var log chainrpc.Log
		if count > 100000 || size > 64<<20 || json.Unmarshal(raw, &log) != nil || log.Address != b.registry {
			return bad
		}
		decoded, e := events.Decode("OfficialStockRegistryV1", log)
		if errors.Is(e, events.ErrUnknown) {
			continue
		}
		if e != nil {
			return bad
		}
		if !strings.HasPrefix(decoded.Signature, "AssetRegistered(") {
			continue
		}
		asset, aok := decoded.Args["assetUid"].(string)
		token, tok := decoded.Args["stockToken"].(string)
		if !aok || !tok || assets[asset] || tokens[token] {
			return bad
		}
		assets[asset] = true
		tokens[token] = true
		if b.check(projection.Input{ChainID: s.ChainID, Module: "OfficialStockRegistryV1", Log: log}) != nil {
			return bad
		}
	}
	if rows.Err() != nil {
		return bad
	}
	return nil
}
