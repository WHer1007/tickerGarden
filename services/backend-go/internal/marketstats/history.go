package marketstats

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"tickergarden/backend/internal/readmodel"
)

// seedHistory reuses locally indexed executions. It never requests historical
// log ranges. A header is read only for an actual candidate buy to confirm that
// its source block remains canonical and obtain its timestamp.
func (s *Service) seedHistory(ctx context.Context, v *State) error {
	rows, err := s.Pool.Query(ctx, `WITH executions AS (
 SELECT e.block_number AS n,e.transaction_index AS ti,e.log_index AS li,e.block_hash AS hash,e.payload->'event' AS event
 FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes d USING(scope_id)
 WHERE d.chain_id=$1 AND e.block_number<=d.processed_through AND (d.config->'modules'->>$2='TickerGardenCurve' OR d.config->'modules'->>$3='UniswapV4PoolManager')
 UNION ALL
 SELECT b.number, (e.payload->'provenance'->>'transactionIndex')::bigint,(e.payload->'provenance'->>'logIndex')::bigint,e.block_hash,e.payload
 FROM tickergarden.canonical_projection_rows e JOIN tickergarden.chain_blocks b ON b.chain_id=e.chain_id AND b.hash=e.block_hash
 WHERE e.chain_id=$1 AND e.table_name='events' AND e.payload->'provenance'->>'emitter' IN ($2,$3)
 ) SELECT n,ti,li,hash,event FROM executions WHERE n<=$5 AND ((event->>'signature'='CurveBuy(address,address,uint256,uint256,uint256,uint256)' AND COALESCE(event->>'emitter',event->'provenance'->>'emitter')=$2) OR (event->>'signature'='Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)' AND event->'args'->>'id'=$4 AND COALESCE(event->>'emitter',event->'provenance'->>'emitter')=$3)) ORDER BY n DESC,ti DESC,li DESC LIMIT 128`, s.Chain, v.Curve, v.Manager, v.Pool, v.Cursor)
	if err != nil {
		return err
	}
	defer rows.Close()
	type candidate struct {
		n, ti, li uint64
		hash      string
		raw       []byte
	}
	items := []candidate{}
	for rows.Next() {
		var c candidate
		if err = rows.Scan(&c.n, &c.ti, &c.li, &c.hash, &c.raw); err != nil {
			return err
		}
		items = append(items, c)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	rows.Close()
	for _, c := range items {
		var e struct {
			Signature string
			Args      map[string]any
		}
		if json.Unmarshal(c.raw, &e) != nil {
			continue
		}
		if e.Signature == swap {
			field := "amount0"
			if v.Token > v.Quote {
				field = "amount1"
			}
			raw, _ := e.Args[field].(string)
			amount, ok := new(big.Int).SetString(raw, 10)
			if !ok || amount.Sign() <= 0 || e.Args["sender"] == v.Hook {
				continue
			}
		}
		h, err := s.RPC.Header(ctx, fmt.Sprintf("0x%x", c.n))
		if err != nil {
			return err
		}
		if h.Hash != c.hash {
			continue
		}
		ts, err := h.Time()
		if err != nil {
			return err
		}
		buy := readmodel.LastBuyReadModel{BlockNumber: strconv.FormatUint(c.n, 10), TransactionIndex: strconv.FormatUint(c.ti, 10), LogIndex: strconv.FormatUint(c.li, 10), Timestamp: strconv.FormatUint(ts, 10)}
		v.LastBuy = &buy
		v.Buys = []BuyHistory{{buy, c.hash}}
		break
	}
	return nil
}
