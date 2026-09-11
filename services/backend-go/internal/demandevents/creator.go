package demandevents

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/eventfeed"
)

// Resolves creator() once per database-observed token. Never scans blocks or
// substitutes the transferable revenue beneficiary for the original issuer.
func (s *Service) CreatorMarkets(ctx context.Context, address, cursor string, limit int) (eventfeed.CreatorMarkets, error) {
	out := eventfeed.CreatorMarkets{ChainID: s.Default.ChainID, Address: address, DisplayOnly: true, Items: []eventfeed.CreatorMarket{}}
	factory := ""
	for a, module := range s.Default.Modules {
		if module == "TickerGardenFactoryV1" {
			factory = a
		}
	}
	if factory == "" {
		return out, errors.New("factory unavailable")
	}
	s.creatorMu.Lock()
	defer s.creatorMu.Unlock()
	const created = ` FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes s USING(scope_id) WHERE e.scope_id=$1 AND e.block_number<=s.processed_through AND e.payload->'event'->>'signature'='MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)' AND e.payload->'event'->>'emitter'=$2`
	rows, err := s.Pool.Query(ctx, `SELECT e.payload->'event'->'args'->>'marketId',e.payload->'event'->'args'->>'memeToken',e.block_number::text,e.block_hash`+created+` AND NOT EXISTS(SELECT 1 FROM tickergarden.creator_market_directory d WHERE d.scope_id=e.scope_id AND d.market_id=e.payload->'event'->'args'->>'marketId' AND d.creation_block_hash=e.block_hash) ORDER BY e.block_number LIMIT 17`, s.Default.ID, factory)
	if err != nil {
		return out, err
	}
	type missing struct{ id, token, number, hash string }
	todo := []missing{}
	for rows.Next() {
		var row missing
		if err = rows.Scan(&row.id, &row.token, &row.number, &row.hash); err != nil {
			rows.Close()
			return out, err
		}
		todo = append(todo, row)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	out.Complete = len(todo) <= 16
	if len(todo) > 16 {
		todo = todo[:16]
	}
	if len(todo) > 0 {
		caller, ok := s.Source.(interface {
			CallAt(context.Context, string, string, string) ([]byte, error)
		})
		if !ok {
			return out, errors.New("creator state reader unavailable")
		}
		// Read at a single current canonical block; creator is immutable.
		head, e := s.Source.Header(ctx, "latest")
		if e != nil {
			return out, e
		}
		for _, row := range todo {
			raw, e := caller.CallAt(ctx, row.token, deployment.Hash([]byte("creator()"))[:10], head.Hash)
			if e != nil {
				return out, e
			}
			if len(raw) != 32 || strings.Trim(hex.EncodeToString(raw[:12]), "0") != "" || strings.Trim(hex.EncodeToString(raw[12:]), "0") == "" {
				return out, errors.New("invalid token creator")
			}
			creator := "0x" + hex.EncodeToString(raw[12:])
			_, e = s.Pool.Exec(ctx, `INSERT INTO tickergarden.creator_market_directory(scope_id,market_id,meme_token,creator,creation_block_number,creation_block_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scope_id,market_id) DO UPDATE SET meme_token=excluded.meme_token,creator=excluded.creator,creation_block_number=excluded.creation_block_number,creation_block_hash=excluded.creation_block_hash`, s.Default.ID, row.id, row.token, creator, row.number, row.hash)
			if e != nil {
				return out, e
			}
		}
	}
	rows, err = s.Pool.Query(ctx, `SELECT d.market_id,d.meme_token,d.creator,d.creation_block_number::text FROM tickergarden.creator_market_directory d WHERE d.scope_id=$1 AND d.creator=$3 AND d.market_id>$4 AND EXISTS(SELECT 1`+created+` AND e.payload->'event'->'args'->>'marketId'=d.market_id AND e.block_hash=d.creation_block_hash) ORDER BY d.market_id LIMIT $5`, s.Default.ID, factory, address, cursor, limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var row eventfeed.CreatorMarket
		if err = rows.Scan(&row.MarketID, &row.MemeToken, &row.Creator, &row.CreationBlockNumber); err != nil {
			return out, err
		}
		out.Items = append(out.Items, row)
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[limit-1].MarketID
		out.NextCursor = &last
	}
	return out, rows.Err()
}
