// Package marketidentity persists immutable display observations at the original
// market creation block. It never uses the wall clock as the creation timestamp.
package marketidentity

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type Worker struct {
	Pool     *pgxpool.Pool
	RPC      deployment.BindingObserver
	Manifest deployment.Manifest
}
type Result struct {
	Action    string `json:"action"`
	MarketID  string `json:"marketId,omitempty"`
	BlockHash string `json:"blockHash,omitempty"`
}

func ManifestHash(m deployment.Manifest) (string, error) {
	m.Contracts = append([]deployment.Contract(nil), m.Contracts...)
	sort.Slice(m.Contracts, func(i, j int) bool { return m.Contracts[i].Address < m.Contracts[j].Address })
	raw, e := json.Marshal(m)
	if e != nil {
		return "", e
	}
	if _, e = deployment.Parse(raw); e != nil {
		return "", e
	}
	return deployment.Hash(raw), nil
}
func (w Worker) Step(ctx context.Context) (Result, error) {
	fail := func(e error) (Result, error) { return Result{}, e }
	if w.Pool == nil || w.RPC == nil {
		return fail(errors.New("invalid identity worker configuration"))
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	mh, e := ManifestHash(w.Manifest)
	if e != nil {
		return fail(e)
	}
	tx, e := w.Pool.Begin(ctx)
	if e != nil {
		return fail(e)
	}
	defer tx.Rollback(ctx)
	var locked bool
	if e = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, int64(730000000+w.Manifest.ChainID)).Scan(&locked); e != nil {
		return fail(e)
	}
	if !locked {
		return Result{Action: "busy"}, nil
	}
	var genesis, stored string
	var final, tip *uint64
	var tipHash *string
	e = tx.QueryRow(ctx, `SELECT j.genesis_hash,c.manifest_hash,j.finalized_number,c.tip_number,c.tip_hash FROM tickergarden.chain_journal j JOIN tickergarden.discovery_checkpoints c USING(chain_id) WHERE chain_id=$1`, w.Manifest.ChainID).Scan(&genesis, &stored, &final, &tip, &tipHash)
	if errors.Is(e, pgx.ErrNoRows) {
		return Result{Action: "waiting_for_discovery"}, nil
	}
	if e != nil {
		return fail(e)
	}
	if genesis != w.Manifest.GenesisHash || stored != mh {
		return fail(errors.New("identity worker discovery scope mismatch"))
	}
	if final == nil || tip == nil {
		return Result{Action: "waiting_for_discovery"}, nil
	}
	var tipOK bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND hash=$3 AND canonical AND receipts_verified)`, w.Manifest.ChainID, *tip, *tipHash).Scan(&tipOK); e != nil || !tipOK || *tip > *final {
		return fail(errors.New("identity discovery checkpoint invalidated"))
	}
	var market, hash string
	var number uint64
	var timestamp *uint64
	var raw []byte
	e = tx.QueryRow(ctx, `SELECT d.market_id,d.block_hash,b.number,b.block_timestamp,d.payload FROM tickergarden.canonical_discovered_markets d JOIN tickergarden.chain_blocks b ON b.chain_id=d.chain_id AND b.hash=d.block_hash LEFT JOIN tickergarden.market_identities i ON i.chain_id=d.chain_id AND i.block_hash=d.block_hash AND i.market_id=d.market_id WHERE d.chain_id=$1 AND b.number<=$2 AND i.market_id IS NULL ORDER BY b.number,d.market_id LIMIT 1`, w.Manifest.ChainID, *tip).Scan(&market, &hash, &number, &timestamp, &raw)
	if errors.Is(e, pgx.ErrNoRows) {
		return Result{Action: "idle"}, nil
	}
	if e != nil {
		return fail(e)
	}
	if timestamp == nil {
		return fail(errors.New("creation block timestamp unavailable; backfill journal first"))
	}
	var discovered deployment.MarketDiscovery
	if json.Unmarshal(raw, &discovered) != nil || discovered.MarketID != market || discovered.Source.BlockHash != hash || discovered.Source.BlockNumber != fmt.Sprintf("0x%x", number) {
		return fail(errors.New("discovery payload identity mismatch"))
	}
	block := chainrpc.Header{Number: fmt.Sprintf("0x%x", number), Hash: hash, Timestamp: fmt.Sprintf("0x%x", *timestamp)}
	current, e := w.RPC.Header(ctx, "finalized")
	if e != nil {
		return fail(e)
	}
	height, e := current.Height()
	if e != nil || height < *final {
		return fail(errors.New("identity RPC finality regressed"))
	}
	tipBlock, e := w.RPC.Header(ctx, fmt.Sprintf("0x%x", *tip))
	if e != nil || tipBlock.Hash != *tipHash || tipBlock.Number != fmt.Sprintf("0x%x", *tip) {
		return fail(errors.New("discovery checkpoint changed on RPC"))
	}
	observed, e := deployment.ObserveMarketIdentity(ctx, w.RPC, w.Manifest, block, market)
	if e != nil {
		return fail(e)
	}
	if observed.MemeToken != discovered.State["memeToken"] || observed.DeployedAt != fmt.Sprint(*timestamp) {
		return fail(errors.New("identity differs from original creation"))
	}
	matched := false
	for _, c := range discovered.Contracts {
		if c.Module == "TickerMemeTokenV1" && c.Address == observed.MemeToken && c.RuntimeCodeHash == observed.RuntimeCodeHash {
			matched = true
		}
	}
	if !matched {
		return fail(errors.New("identity runtime differs from discovery"))
	}
	payload, e := json.Marshal(observed)
	if e != nil {
		return fail(e)
	}
	digest := sha256.Sum256(payload)
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.market_identities(chain_id,block_hash,market_id,manifest_hash,payload,digest) VALUES($1,$2,$3,$4,$5,$6)`, w.Manifest.ChainID, hash, market, mh, payload, hex.EncodeToString(digest[:])); e != nil {
		return fail(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return fail(errors.New("identity commit uncertain; retry safely"))
	}
	return Result{Action: "observed", MarketID: market, BlockHash: hash}, nil
}
