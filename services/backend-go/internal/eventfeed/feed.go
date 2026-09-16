// Package eventfeed serves finalized event facts for display, never balances or
// settlement authority. Its API and database pool are independent of analytics.
package eventfeed

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strconv"
	"time"
)

type Store struct {
	Pool                       *pgxpool.Pool
	Chain                      uint64
	Genesis, Manifest, Version string
}
type Event struct {
	Key         string          `json:"key"`
	BlockNumber string          `json:"blockNumber"`
	BlockHash   string          `json:"blockHash"`
	Payload     json.RawMessage `json:"payload"`
}
type Feed struct {
	Finality            string    `json:"finality,omitempty"`
	HistoryFrom         string    `json:"historyFrom,omitempty"`
	Scope               string    `json:"scope,omitempty"`
	ObservedThrough     string    `json:"observedThrough,omitempty"`
	Processing          bool      `json:"processing,omitempty"`
	ChainID             uint64    `json:"chainId"`
	IndexedThrough      string    `json:"indexedThrough"`
	BlockHash           string    `json:"blockHash"`
	FinalizedThrough    string    `json:"finalizedThrough"`
	LagBlocks           string    `json:"lagBlocks"`
	SourceObservedAt    time.Time `json:"sourceObservedAt"`
	Stale               bool      `json:"stale"`
	DisplayOnly         bool      `json:"displayOnly"`
	FinanciallyVerified bool      `json:"financiallyVerified"`
	Events              []Event   `json:"events"`
}

func (s *Store) Load(ctx context.Context, limit int) (Feed, error) {
	fail := func() (Feed, error) { return Feed{}, errors.New("event feed unavailable") }
	if s.Pool == nil || limit < 1 || limit > 100 {
		return fail()
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return fail()
	}
	defer tx.Rollback(ctx)
	var tip, final uint64
	out := Feed{ChainID: s.Chain, DisplayOnly: true, FinanciallyVerified: false, Events: []Event{}}
	e = tx.QueryRow(ctx, `SELECT p.tip_number,p.tip_hash,j.finalized_number,j.updated_at FROM tickergarden.event_projection_checkpoints p JOIN tickergarden.chain_journal j USING(chain_id) JOIN tickergarden.discovery_checkpoints d USING(chain_id) JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.tip_hash WHERE p.chain_id=$1 AND p.manifest_hash=$2 AND p.projector_version=$3 AND j.genesis_hash=$4 AND d.manifest_hash=p.manifest_hash AND d.start_block=p.start_block AND p.tip_number<=d.tip_number AND p.tip_number<=j.finalized_number AND b.number=p.tip_number AND b.canonical AND b.receipts_verified`, s.Chain, s.Manifest, s.Version, s.Genesis).Scan(&tip, &out.BlockHash, &final, &out.SourceObservedAt)
	if e != nil {
		return fail()
	}
	out.IndexedThrough = strconv.FormatUint(tip, 10)
	out.FinalizedThrough = strconv.FormatUint(final, 10)
	out.LagBlocks = strconv.FormatUint(final-tip, 10)
	age := time.Since(out.SourceObservedAt)
	out.Stale = age > 120*time.Second || age < -5*time.Second
	rows, e := tx.Query(ctx, `SELECT r.row_key,b.number::text,r.block_hash,CASE WHEN octet_length(r.payload::text)<=131072 THEN r.payload ELSE NULL END FROM tickergarden.canonical_event_projection_rows r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=$1 AND r.table_name='events' ORDER BY b.number DESC,r.row_key DESC LIMIT $2`, s.Chain, limit)
	if e != nil {
		return fail()
	}
	defer rows.Close()
	for rows.Next() {
		var event Event
		if e = rows.Scan(&event.Key, &event.BlockNumber, &event.BlockHash, &event.Payload); e != nil || !json.Valid(event.Payload) {
			return fail()
		}
		out.Events = append(out.Events, event)
	}
	if rows.Err() != nil {
		return fail()
	}
	rows.Close()
	if tx.Commit(ctx) != nil {
		return fail()
	}
	return out, nil
}

type Reader interface {
	Load(context.Context, int) (Feed, error)
}

func Handler(reader Reader) http.Handler {
	slots := make(chan struct{}, 4)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path != "/events" {
			http.NotFound(w, r)
			return
		}
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		if len(r.URL.Query().Get("scope")) > 200 {
			w.WriteHeader(400)
			return
		}
		limit := 50
		if raw := r.URL.Query().Get("limit"); raw != "" {
			v, e := strconv.Atoi(raw)
			if e != nil || v < 1 || v > 100 || strconv.Itoa(v) != raw {
				w.WriteHeader(400)
				return
			}
			limit = v
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(503)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		var out Feed
		var e error
		if scoped, ok := reader.(interface {
			LoadScope(context.Context, string, int) (Feed, error)
		}); ok {
			out, e = scoped.LoadScope(ctx, r.URL.Query().Get("scope"), limit)
		} else {
			out, e = reader.Load(ctx, limit)
		}
		if e != nil || ctx.Err() != nil {
			w.WriteHeader(503)
			json.NewEncoder(w).Encode(map[string]string{"error": "event_feed_unavailable"})
			return
		}
		out.DisplayOnly = true
		out.FinanciallyVerified = false
		json.NewEncoder(w).Encode(out)
	})
}
