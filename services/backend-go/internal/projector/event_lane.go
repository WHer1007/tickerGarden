package projector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
)

const EventVersion = "event-facts-v1"

func (w *Worker) version() string {
	if w.EventsOnly {
		return EventVersion
	}
	return Version
}
func (w *Worker) leaseKey(chain uint64) int64 {
	if w.EventsOnly {
		return int64(740000000 + chain)
	}
	return int64(730000000 + chain)
}

// Names are selected solely by an in-process bool, never external SQL input.
func (w *Worker) sqlForLane(q string) string {
	if !w.EventsOnly {
		return q
	}
	return strings.NewReplacer("tickergarden.canonical_projection_rows", "tickergarden.canonical_event_projection_rows", "tickergarden.projection_checkpoints", "tickergarden.event_projection_checkpoints", "tickergarden.projection_inputs", "tickergarden.event_projection_inputs", "tickergarden.projection_rows", "tickergarden.event_projection_rows").Replace(q)
}
func (w *Worker) finishEvents(ctx context.Context, tx pgx.Tx, chain uint64, h chainrpc.Header, count uint64, events int) (Result, error) {
	n, e := h.Height()
	if e != nil {
		return Result{}, e
	}
	id, e := w.RPC.ChainID(ctx)
	if e != nil || id != chain {
		return Result{}, errors.New("event lane chain changed before commit")
	}
	current, e := w.RPC.Header(ctx, h.Number)
	if e != nil {
		return Result{}, e
	}
	if !strings.EqualFold(current.Hash, h.Hash) || current.Timestamp != h.Timestamp {
		return Result{}, errors.New("event lane source changed before commit")
	}
	if _, e = tx.Exec(ctx, w.sqlForLane(`UPDATE tickergarden.projection_checkpoints SET tip_number=$2,tip_hash=$3,input_count=$4,updated_at=now() WHERE chain_id=$1`), chain, n, h.Hash, count); e != nil {
		return Result{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Result{}, e
	}
	return Result{Action: "events_projected", Lane: "events-only-display", BlockNumber: &n, Events: events}, nil
}

// Batch ONLY receipt-verified empty-log blocks with complete discovery coverage.
// Time-dependent financial state is not inferred here; it belongs to the other lane.
func (w *Worker) finishEmptyEvents(ctx context.Context, tx pgx.Tx, chain uint64, first chainrpc.Header, count, ceiling uint64, candidateSets ...[]string) (Result, error) {
	start, e := first.Height()
	if e != nil {
		return Result{}, e
	}
	end := min(start+255, ceiling)
	var candidates []string
	if len(candidateSets) > 0 {
		candidates = candidateSets[0]
	}
	rows, e := tx.Query(ctx, `SELECT b.number,b.hash,b.parent_hash,b.block_timestamp,EXISTS(SELECT 1 FROM tickergarden.chain_logs l WHERE l.chain_id=b.chain_id AND l.block_hash=b.hash AND ($4::text[] IS NULL OR l.address=ANY($4)))
 FROM tickergarden.chain_blocks b JOIN tickergarden.discovery_batches d ON d.chain_id=b.chain_id AND d.block_hash=b.hash
 WHERE b.chain_id=$1 AND b.number BETWEEN $2 AND $3 AND b.canonical AND b.events_verified ORDER BY b.number`, chain, start, end, candidates)
	if e != nil {
		return Result{}, e
	}
	defer rows.Close()
	last := first
	expected := start
	previous := first.ParentHash
	for rows.Next() {
		var n, stamp uint64
		var hash, parent string
		var hasLogs bool
		if e = rows.Scan(&n, &hash, &parent, &stamp, &hasLogs); e != nil {
			return Result{}, e
		}
		if n != expected || parent != previous {
			return Result{}, errors.New("event empty interval is not contiguous")
		}
		if hasLogs {
			break
		}
		if n == start && (hash != first.Hash || fmt.Sprintf("0x%x", stamp) != first.Timestamp) {
			return Result{}, errors.New("event first block changed")
		}
		last = chainrpc.Header{Number: fmt.Sprintf("0x%x", n), Hash: hash, ParentHash: parent, Timestamp: fmt.Sprintf("0x%x", stamp)}
		previous = hash
		expected++
	}
	if e = rows.Err(); e != nil {
		return Result{}, e
	}
	rows.Close()
	if expected == start {
		return Result{}, errors.New("empty event block evidence missing")
	}
	result, err := w.finishEvents(ctx, tx, chain, last, count, 0)
	if err == nil && w.cache != nil && w.cacheEventsOnly && w.cacheHash == first.ParentHash {
		w.cacheHash = last.Hash
	}
	return result, err
}

// Candidate membership can only trigger MORE verification; it never authorizes
// an event. Include future discovered instances through this bounded batch end,
// so creation and first use in one block cannot be skipped.
func (w *Worker) candidateEmitters(ctx context.Context, tx pgx.Tx, chain, through uint64) ([]string, error) {
	set := map[string]bool{}
	registry := ""
	for _, c := range w.Manifest.Contracts {
		set[strings.ToLower(c.Address)] = true
		if c.Module == "OfficialStockRegistryV1" {
			registry = c.Address
		}
	}
	rows, e := tx.Query(ctx, `SELECT d.payload FROM tickergarden.canonical_discovered_markets d JOIN tickergarden.chain_blocks b ON b.chain_id=d.chain_id AND b.hash=d.block_hash WHERE d.chain_id=$1 AND b.number<=$2 LIMIT 4097`, chain, through)
	if e != nil {
		return nil, e
	}
	marketCount := 0
	for rows.Next() {
		marketCount++
		if marketCount > 4096 {
			rows.Close()
			return nil, errors.New("event market candidate budget exceeded")
		}
		var raw []byte
		var m deployment.MarketDiscovery
		if e = rows.Scan(&raw); e != nil {
			rows.Close()
			return nil, e
		}
		if json.Unmarshal(raw, &m) != nil {
			rows.Close()
			return nil, errors.New("invalid event candidate discovery")
		}
		for _, c := range m.Contracts {
			set[strings.ToLower(c.Address)] = true
		}
		if len(set) > 16384 {
			rows.Close()
			return nil, errors.New("event candidate budget exceeded")
		}
	}
	if e = rows.Err(); e != nil {
		rows.Close()
		return nil, e
	}
	rows.Close()
	rows, e = tx.Query(ctx, `SELECT l.payload FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE l.chain_id=$1 AND l.address=$2 AND b.canonical AND b.events_verified AND b.number<=$3 AND l.payload->'topics'->>0=$4 LIMIT 10001`, chain, registry, through, deployment.Hash([]byte("AssetRegistered(bytes32,address,address,uint8)")))
	if e != nil {
		return nil, e
	}
	count := 0
	for rows.Next() {
		count++
		var raw []byte
		var log chainrpc.Log
		if e = rows.Scan(&raw); e != nil {
			rows.Close()
			return nil, e
		}
		if json.Unmarshal(raw, &log) != nil || count > 10000 {
			rows.Close()
			return nil, errors.New("event asset candidate budget or encoding invalid")
		}
		event, e := events.Decode("OfficialStockRegistryV1", log)
		if e != nil {
			rows.Close()
			return nil, e
		}
		a, ok := event.Args["userStockVault"].(string)
		if !ok {
			rows.Close()
			return nil, errors.New("invalid event vault candidate")
		}
		set[strings.ToLower(a)] = true
	}
	if e = rows.Err(); e != nil {
		rows.Close()
		return nil, e
	}
	rows.Close()
	out := make([]string, 0, len(set))
	for a := range set {
		out = append(out, a)
	}
	sort.Strings(out)
	return out, nil
}
