package demandevents

import (
	"context"
	"errors"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"strings"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/eventfeed"
)

// Registration events exist only when holder fee sharing is enabled. Search
// cached immutable token identities; never scan blocks in response to a search.
func (s *Service) HolderMarkets(ctx context.Context, q string) (eventfeed.HolderMarkets, error) {
	out := eventfeed.HolderMarkets{ChainID: s.Default.ChainID, Items: []eventfeed.HolderMarket{}, Complete: true}
	distributors := []string{}
	for a, m := range s.Default.Modules {
		if m == "TreasuryDistributorV1" || m == "HolderRewardsDistributorV1" {
			distributors = append(distributors, a)
		}
	}
	if len(distributors) == 0 {
		return out, errors.New("holder distributor unavailable")
	}
	s.creatorMu.Lock()
	defer s.creatorMu.Unlock()
	const registered = ` FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes s USING(scope_id) WHERE e.scope_id=$1 AND e.block_number<=s.processed_through AND e.payload->'event'->>'emitter'=ANY($2::text[]) AND e.payload->'event'->>'signature' IN ('HolderStreamMarketRegistered(bytes32,address,address,address)','TreasuryMarketRegistered(bytes32,address,address,bytes32)')`
	rows, err := s.Pool.Query(ctx, `SELECT e.payload->'event'->'args'->>'marketId',COALESCE(e.payload->'event'->'args'->>'token',e.payload->'event'->'args'->>'memeToken'),e.block_hash`+registered+` AND NOT EXISTS(SELECT 1 FROM tickergarden.holder_market_directory d WHERE d.scope_id=e.scope_id AND d.market_id=e.payload->'event'->'args'->>'marketId' AND d.registration_block_hash=e.block_hash) ORDER BY e.block_number LIMIT 17`, s.Default.ID, distributors)
	if err != nil {
		return out, err
	}
	type missing struct{ id, token, hash string }
	todo := []missing{}
	for rows.Next() {
		var m missing
		if err = rows.Scan(&m.id, &m.token, &m.hash); err != nil {
			rows.Close()
			return out, err
		}
		todo = append(todo, m)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if len(todo) > 16 {
		out.Complete = false
		todo = todo[:16]
	}
	if len(todo) > 0 {
		caller, ok := s.Source.(interface {
			CallAt(context.Context, string, string, string) ([]byte, error)
		})
		if !ok {
			return out, errors.New("token reader unavailable")
		}
		head, e := s.Source.Header(ctx, "latest")
		if e != nil {
			return out, e
		}
		typ, _ := abi.NewType("string", "", nil)
		args := abi.Arguments{{Type: typ}}
		for _, m := range todo {
			values := []string{}
			for _, method := range []string{"name()", "symbol()"} {
				raw, e := caller.CallAt(ctx, m.token, deployment.Hash([]byte(method))[:10], head.Hash)
				if e != nil {
					return out, e
				}
				decoded, e := args.Unpack(raw)
				if e != nil || len(decoded) != 1 {
					return out, errors.New("invalid token identity")
				}
				value, ok := decoded[0].(string)
				if !ok || len(value) > 256 || strings.ContainsRune(value, 0) {
					return out, errors.New("invalid token identity")
				}
				values = append(values, value)
			}
			_, e = s.Pool.Exec(ctx, `INSERT INTO tickergarden.holder_market_directory VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scope_id,market_id) DO UPDATE SET meme_token=excluded.meme_token,name=excluded.name,symbol=excluded.symbol,registration_block_hash=excluded.registration_block_hash`, s.Default.ID, m.id, m.token, values[0], values[1], m.hash)
			if e != nil {
				return out, e
			}
		}
	}
	rows, err = s.Pool.Query(ctx, `SELECT d.market_id,d.meme_token,d.name,d.symbol FROM tickergarden.holder_market_directory d WHERE d.scope_id=$1 AND (strpos(lower(d.name),lower($3))>0 OR strpos(lower(d.symbol),lower($3))>0 OR strpos(lower(d.meme_token),lower($3))>0) AND EXISTS(SELECT 1`+registered+` AND e.payload->'event'->'args'->>'marketId'=d.market_id AND e.block_hash=d.registration_block_hash) ORDER BY lower(d.symbol),d.market_id LIMIT 20`, s.Default.ID, distributors, q)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var m eventfeed.HolderMarket
		if err = rows.Scan(&m.MarketID, &m.MemeToken, &m.Name, &m.Symbol); err != nil {
			return out, err
		}
		out.Items = append(out.Items, m)
	}
	return out, rows.Err()
}
