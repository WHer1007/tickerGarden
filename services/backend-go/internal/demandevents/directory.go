package demandevents

import (
	"context"
	"encoding/json"
	"tickergarden/backend/internal/eventfeed"
)

// Database-only creation directory. Trading activity cannot evict old markets
// from a latest-N generic event feed. Trigger demand sync without waiting for it.
func (s *Service) MarketDirectory(ctx context.Context, cursor string) (eventfeed.Directory, error) {
	feed, e := s.Load(ctx, 1)
	out := eventfeed.Directory{Feed: feed}
	out.Events = []eventfeed.Event{}
	if e != nil {
		return out, e
	}
	factory := ""
	for a, m := range s.Default.Modules {
		if m == "TickerGardenFactoryV1" {
			factory = a
		}
	}
	rows, e := s.Pool.Query(ctx, `SELECT e.block_number::text,e.block_hash,e.payload,e.payload->'event'->'args'->>'marketId' FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes d USING(scope_id) WHERE e.scope_id=$1 AND e.block_number<=d.processed_through AND e.payload->'event'->>'emitter'=$2 AND e.payload->'event'->>'signature'='MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)' AND e.payload->'event'->'args'->>'marketId'>$3 ORDER BY e.payload->'event'->'args'->>'marketId' LIMIT 101`, s.Default.ID, factory, cursor)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	last := ""
	for rows.Next() {
		var item eventfeed.Event
		var id string
		var raw []byte
		if e = rows.Scan(&item.BlockNumber, &item.BlockHash, &raw, &id); e != nil {
			return out, e
		}
		if len(out.Events) == 100 {
			out.NextCursor = &last
			break
		}
		item.Payload = json.RawMessage(raw)
		out.Events = append(out.Events, item)
		last = id
	}
	return out, rows.Err()
}
