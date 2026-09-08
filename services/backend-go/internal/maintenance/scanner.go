package maintenance

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
)

// Scanner enumerates canonical discovered markets. Its queue grants observation
// rights only; DiscoverWork remains the authority for authenticated simulations.
type Scanner struct {
	Store    Store
	RPC      DiscoveryRPC
	Manifest deployment.Manifest
	From     string
}
type ScanResult struct {
	Action    string           `json:"action"`
	MarketID  string           `json:"marketId,omitempty"`
	Operation string           `json:"operation,omitempty"`
	User      string           `json:"user,omitempty"`
	Status    string           `json:"status,omitempty"`
	Discovery *DiscoveryResult `json:"discovery,omitempty"`
}
type scanClaim struct {
	market, operation, user string
	generation              int64
	failures                int
}

func (w Scanner) claim(ctx context.Context) (scanClaim, error) {
	tx, e := w.Store.Pool.Begin(ctx)
	if e != nil {
		return scanClaim{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	// Only finalized, verified journal discovery supplies candidates. An expanded
	// runtime manifest may differ from the original discovery manifest; every
	// candidate is authenticated again by DiscoverWork before any job is created.
	var valid bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_journal j
 JOIN tickergarden.discovery_checkpoints c USING(chain_id)
 JOIN tickergarden.chain_blocks b ON b.chain_id=c.chain_id AND b.hash=c.tip_hash AND b.number=c.tip_number
 WHERE j.chain_id=$1 AND j.genesis_hash=$2 AND b.canonical AND b.receipts_verified AND c.tip_number<=j.finalized_number)`, w.Store.ChainID, w.Manifest.GenesisHash).Scan(&valid)
	if e != nil || !valid {
		return scanClaim{}, ErrUnavailable
	}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_scan_queue(chain_id,genesis_hash,sender,market_id,operation)
 SELECT d.chain_id,$2,$3,d.market_id,o.operation FROM tickergarden.canonical_discovered_markets d
 CROSS JOIN (VALUES ('sweep'),('checkpoint'),('flush-forfeiture'),('treasury-activate')) o(operation)
 WHERE d.chain_id=$1 AND NOT EXISTS(SELECT 1 FROM tickergarden.maintenance_scan_queue q
 WHERE q.chain_id=d.chain_id AND q.genesis_hash=$2 AND q.sender=$3 AND q.market_id=d.market_id AND q.operation=o.operation)
 ORDER BY d.market_id,o.operation LIMIT 100 ON CONFLICT DO NOTHING`, w.Store.ChainID, w.Manifest.GenesisHash, w.From)
	if e != nil {
		return scanClaim{}, ErrUnavailable
	}
	// Canonical projected account identities are candidates only. Enumerate all
	// known gauge accounts so an older pending flag cannot suppress a live check.
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_scan_queue(chain_id,genesis_hash,sender,market_id,operation,user_address)
 SELECT p.chain_id,$2,$3,split_part(p.row_key,':',2),'settle-rage-quit',split_part(p.row_key,':',1)
 FROM tickergarden.canonical_projection_rows p
 WHERE p.chain_id=$1 AND p.table_name='gaugePositions'
 AND p.row_key ~ '^0x[0-9a-f]{40}:0x[0-9a-f]{64}$'
 AND split_part(p.row_key,':',1)<>'0x0000000000000000000000000000000000000000'
 AND EXISTS(SELECT 1 FROM tickergarden.canonical_discovered_markets d WHERE d.chain_id=p.chain_id AND d.market_id=split_part(p.row_key,':',2))
 AND NOT EXISTS(SELECT 1 FROM tickergarden.maintenance_scan_queue q WHERE q.chain_id=p.chain_id AND q.genesis_hash=$2 AND q.sender=$3
 AND q.market_id=split_part(p.row_key,':',2) AND q.operation='settle-rage-quit' AND q.user_address=split_part(p.row_key,':',1))
 ORDER BY p.row_key LIMIT 100 ON CONFLICT DO NOTHING`, w.Store.ChainID, w.Manifest.GenesisHash, w.From)
	if e != nil {
		return scanClaim{}, ErrUnavailable
	}
	var c scanClaim
	e = tx.QueryRow(ctx, `SELECT q.market_id,q.operation,q.user_address,q.generation,q.failures FROM tickergarden.maintenance_scan_queue q
 WHERE q.chain_id=$1 AND q.genesis_hash=$2 AND q.sender=$3 AND q.due_at<=clock_timestamp() AND q.claim_until<=clock_timestamp()
 AND EXISTS(SELECT 1 FROM tickergarden.canonical_discovered_markets d WHERE d.chain_id=q.chain_id AND d.market_id=q.market_id)
 AND (q.operation<>'settle-rage-quit' OR EXISTS(SELECT 1 FROM tickergarden.canonical_projection_rows p
 WHERE p.chain_id=q.chain_id AND p.table_name='gaugePositions' AND p.row_key=q.user_address||':'||q.market_id))
 ORDER BY q.due_at,q.market_id,q.operation,q.user_address FOR UPDATE OF q SKIP LOCKED LIMIT 1`, w.Store.ChainID, w.Manifest.GenesisHash, w.From).Scan(&c.market, &c.operation, &c.user, &c.generation, &c.failures)
	if errors.Is(e, pgx.ErrNoRows) {
		if tx.Commit(ctx) != nil {
			return scanClaim{}, ErrUnavailable
		}
		return c, nil
	}
	if e != nil || c.generation == 1<<63-1 {
		return scanClaim{}, ErrUnavailable
	}
	c.generation++
	_, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_scan_queue SET generation=$6,claim_until=clock_timestamp()+interval '120 seconds'
 WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 AND market_id=$4 AND operation=$5 AND user_address=$7`, w.Store.ChainID, w.Manifest.GenesisHash, w.From, c.market, c.operation, c.generation, c.user)
	if e != nil || tx.Commit(ctx) != nil {
		return scanClaim{}, ErrUnavailable
	}
	return c, nil
}
func (w Scanner) finish(ctx context.Context, c scanClaim, status string) error {
	failures := 0
	delay := int64(60)
	if status == "unavailable" {
		failures = c.failures + 1
		if failures > 16 {
			failures = 16
		}
		delay = int64(reconcileDelay(status, failures).Seconds())
	}
	tag, e := w.Store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_scan_queue SET status=$7,failures=$8,
 checked_at=clock_timestamp(),due_at=clock_timestamp()+$9*interval '1 second',claim_until='-infinity'
 WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 AND market_id=$4 AND operation=$5 AND generation=$6 AND user_address=$10 AND claim_until>clock_timestamp()`, w.Store.ChainID, w.Manifest.GenesisHash, w.From, c.market, c.operation, c.generation, status, failures, delay, c.user)
	if e != nil || tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}
func (w Scanner) Step(ctx context.Context) (ScanResult, error) {
	if w.Store.Pool == nil || w.RPC == nil || w.Manifest.ChainID != w.Store.ChainID || !discoveryAddress.MatchString(w.From) || w.From == "0x0000000000000000000000000000000000000000" {
		return ScanResult{}, ErrUnavailable
	}
	id, e := w.RPC.ChainID(ctx)
	if e != nil || id != w.Store.ChainID {
		return ScanResult{}, ErrUnavailable
	}
	genesis, e := w.RPC.Header(ctx, "0x0")
	if e != nil || genesis.Hash != w.Manifest.GenesisHash {
		return ScanResult{}, ErrUnavailable
	}
	c, e := w.claim(ctx)
	if e != nil {
		return ScanResult{}, e
	}
	if c.market == "" {
		return ScanResult{Action: "idle"}, nil
	}
	r := ScanResult{Action: "checked", MarketID: c.market, Operation: c.operation, User: c.user, Status: "unavailable"}
	d, e := w.Store.DiscoverWork(ctx, w.RPC, w.Manifest, w.From, deployment.MaintenanceRequest{Operation: c.operation, MarketID: c.market, User: c.user})
	if e == nil {
		r.Status = d.Status
		r.Discovery = &d
	}
	if e = w.finish(ctx, c, r.Status); e != nil {
		return ScanResult{}, e
	}
	return r, nil
}
