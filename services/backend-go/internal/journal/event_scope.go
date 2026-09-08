package journal

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

var ErrEventScopePending = errors.New("waiting for authenticated market discovery")

// ProjectEmitters includes only manifest modules and authenticated factory and
// registry children. A factory event fences subsequent exclusion until discovery
// has processed it, so a lagging discovery worker cannot omit new child events.
func ProjectEmitters(ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, h chainrpc.Header) ([]string, error) {
	n, err := h.Height()
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	factory, registry, manager := "", "", ""
	for _, c := range m.Contracts {
		if c.Module == "UniswapV4PoolManager" {
			manager = c.Address
			continue
		}
		set[c.Address] = true
		if c.Module == "TickerGardenFactoryV1" {
			factory = c.Address
		}
		if c.Module == "OfficialStockRegistryV1" {
			registry = c.Address
		}
	}
	var pending bool
	err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE l.chain_id=$1 AND b.canonical AND b.events_verified AND b.number<$2 AND l.address=$3 AND NOT EXISTS(SELECT 1 FROM tickergarden.discovery_checkpoints d WHERE d.chain_id=$1 AND d.tip_number>=b.number))`, m.ChainID, n, factory).Scan(&pending)
	if err != nil {
		return nil, err
	}
	if pending {
		return nil, ErrEventScopePending
	}
	rows, err := pool.Query(ctx, `SELECT payload FROM tickergarden.canonical_discovered_markets WHERE chain_id=$1 LIMIT 4097`, m.ChainID)
	if err != nil {
		return nil, err
	}
	count := 0
	for rows.Next() {
		var raw []byte
		var d deployment.MarketDiscovery
		count++
		if rows.Scan(&raw) != nil || json.Unmarshal(raw, &d) != nil || count > 4096 {
			rows.Close()
			return nil, errors.New("invalid market scope")
		}
		for _, c := range d.Contracts {
			set[c.Address] = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if count > 0 && manager != "" {
		set[manager] = true
	}
	rows, err = pool.Query(ctx, `SELECT l.payload FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE l.chain_id=$1 AND b.canonical AND b.events_verified AND b.number<$2 AND l.address=$3 AND l.payload->'topics'->>0=$4 LIMIT 10001`, m.ChainID, n, registry, deployment.Hash([]byte("AssetRegistered(bytes32,address,address,uint8)")))
	if err != nil {
		return nil, err
	}
	count = 0
	for rows.Next() {
		count++
		var raw []byte
		var log chainrpc.Log
		if rows.Scan(&raw) != nil || json.Unmarshal(raw, &log) != nil || count > 10000 {
			rows.Close()
			return nil, errors.New("invalid asset scope")
		}
		event, e := events.Decode("OfficialStockRegistryV1", log)
		if e != nil {
			rows.Close()
			return nil, e
		}
		a, ok := event.Args["userStockVault"].(string)
		if !ok {
			rows.Close()
			return nil, errors.New("missing vault scope")
		}
		set[a] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	out := []string{}
	for a := range set {
		out = append(out, a)
	}
	return out, nil
}
