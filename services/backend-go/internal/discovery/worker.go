// Package discovery persists receipt-backed market identity observations. It is
// separate from financial projection and only processes journal-finalized blocks.
package discovery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type Worker struct {
	Pool           *pgxpool.Pool
	RPC            deployment.DiscoveryObserver
	Manifest       deployment.Manifest
	StartBlock     uint64
	EmptyBatchSize uint64
}
type Result struct {
	Action      string  `json:"action"`
	BlockNumber *uint64 `json:"blockNumber,omitempty"`
	Markets     int     `json:"markets"`
	Blocks      uint64  `json:"blocks,omitempty"`
}

func (w *Worker) Step(ctx context.Context) (Result, error) {
	fail := func(err error) (Result, error) { return Result{}, err }
	if w.Pool == nil || w.RPC == nil || w.StartBlock > 1<<63-1 || w.EmptyBatchSize > 256 {
		return fail(errors.New("invalid discovery configuration"))
	}
	// Sorting makes a reordering of the same manifest identities resume safely.
	manifest := w.Manifest
	manifest.Contracts = append([]deployment.Contract{}, manifest.Contracts...)
	sort.Slice(manifest.Contracts, func(i, j int) bool { return manifest.Contracts[i].Address < manifest.Contracts[j].Address })
	raw, err := json.Marshal(manifest)
	if err != nil {
		return fail(err)
	}
	if _, err = deployment.Parse(raw); err != nil {
		return fail(err)
	}
	commitment := deployment.Hash(raw)
	chain := manifest.ChainID
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return fail(errors.New("cannot begin discovery transaction"))
	}
	defer tx.Rollback(context.Background())
	var locked bool
	if err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock($1)", int64(730000000+chain)).Scan(&locked); err != nil {
		return fail(errors.New("cannot acquire discovery lock"))
	}
	if !locked {
		return Result{Action: "busy"}, nil
	}
	var genesis string
	var journalStart uint64
	var finalized *uint64
	var finalizedHash *string
	err = tx.QueryRow(ctx, "SELECT genesis_hash,start_block,finalized_number,finalized_hash FROM tickergarden.chain_journal WHERE chain_id=$1", chain).Scan(&genesis, &journalStart, &finalized, &finalizedHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{Action: "waiting_for_journal"}, nil
	}
	if err != nil {
		return fail(errors.New("cannot read discovery journal scope"))
	}
	if genesis != manifest.GenesisHash || w.StartBlock < journalStart {
		return fail(errors.New("discovery and journal scope mismatch"))
	}
	if _, err = tx.Exec(ctx, `INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, chain, commitment, w.StartBlock); err != nil {
		return fail(errors.New("cannot initialize discovery; run migrations first"))
	}
	var saved string
	var start uint64
	var tip *uint64
	var tipHash *string
	if err = tx.QueryRow(ctx, "SELECT manifest_hash,start_block,tip_number,tip_hash FROM tickergarden.discovery_checkpoints WHERE chain_id=$1 FOR UPDATE", chain).Scan(&saved, &start, &tip, &tipHash); err != nil {
		return fail(errors.New("cannot read discovery checkpoint"))
	}
	if saved != commitment || start != w.StartBlock {
		return fail(errors.New("discovery manifest or start block changed; explicit rebuild required"))
	}
	if tip != nil {
		var canonical bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND hash=$3 AND canonical AND events_verified)`, chain, *tip, *tipHash).Scan(&canonical)
		if err != nil || !canonical || finalized == nil || *tip > *finalized {
			return fail(errors.New("finalized discovery checkpoint invalidated"))
		}
		current, err := w.RPC.Header(ctx, fmt.Sprintf("0x%x", *tip))
		if err != nil {
			return fail(err)
		}
		if !strings.EqualFold(current.Hash, *tipHash) {
			return fail(errors.New("finalized discovery checkpoint changed on RPC"))
		}
	}
	next := start
	if tip != nil {
		next = *tip + 1
	}
	if finalized == nil || next > *finalized {
		if err = tx.Commit(ctx); err != nil {
			return fail(errors.New("cannot commit discovery scope"))
		}
		return Result{Action: "idle"}, nil
	}
	// The journal's finalized anchor must still be canonical on the current RPC.
	final, err := w.RPC.Header(ctx, "finalized")
	if err != nil {
		return fail(err)
	}
	finalN, err := final.Height()
	if err != nil || finalN < *finalized {
		return fail(errors.New("RPC finality regressed behind discovery journal"))
	}
	anchor, err := w.RPC.Header(ctx, fmt.Sprintf("0x%x", *finalized))
	if err != nil {
		return fail(err)
	}
	if !strings.EqualFold(anchor.Hash, *finalizedHash) {
		return fail(errors.New("journal finalized anchor changed on RPC"))
	}
	var header chainrpc.Header
	var blockTime uint64
	header.Number = fmt.Sprintf("0x%x", next)
	err = tx.QueryRow(ctx, `SELECT hash,parent_hash,block_timestamp FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND canonical AND events_verified AND block_timestamp IS NOT NULL`, chain, next).Scan(&header.Hash, &header.ParentHash, &blockTime)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{Action: "waiting_for_journal"}, nil
	}
	if err != nil {
		return fail(errors.New("cannot read discovery source block"))
	}
	header.Timestamp = fmt.Sprintf("0x%x", blockTime)
	if tipHash != nil && header.ParentHash != *tipHash {
		return fail(errors.New("discovery block parent mismatch"))
	}
	if result, handled, err := w.advanceEmptyBatch(ctx, tx, manifest, header, *finalized); err != nil {
		return fail(err)
	} else if handled {
		return result, nil
	}
	// Share and batch immutable code/binding reads within this single pinned
	// block attempt. On fast public chains, serially authenticating the full
	// manifest can exceed the worker deadline even though each read succeeds.
	// The session keeps moving-tag commit fences on the underlying observer.
	session := deployment.NewReadSession(w.RPC, header.Hash)
	markets, err := deployment.DiscoverBlock(ctx, session, manifest, header)
	if err != nil {
		return fail(err)
	}
	if _, err = tx.Exec(ctx, "INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES($1,$2)", chain, header.Hash); err != nil {
		return fail(errors.New("cannot persist discovery batch"))
	}
	for _, market := range markets {
		var duplicate bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.canonical_discovered_markets WHERE chain_id=$1 AND market_id=$2)`, chain, market.MarketID).Scan(&duplicate); err != nil {
			return fail(errors.New("cannot check canonical market identity"))
		}
		if duplicate {
			return fail(errors.New("market identity already discovered on canonical chain"))
		}
		index, err := chainrpc.Quantity(market.Source.LogIndex)
		if err != nil {
			return fail(err)
		}
		var payload []byte
		if err = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2 AND log_index=$3`, chain, header.Hash, index).Scan(&payload); err != nil {
			return fail(errors.New("market source log absent from journal"))
		}
		var source chainrpc.Log
		if json.Unmarshal(payload, &source) != nil || !reflect.DeepEqual(source, market.Source) {
			return fail(errors.New("discovered market source differs from journal"))
		}
		payload, err = json.Marshal(market)
		if err != nil {
			return fail(err)
		}
		if _, err = tx.Exec(ctx, `INSERT INTO tickergarden.discovered_markets(chain_id,block_hash,market_id,log_index,payload) VALUES($1,$2,$3,$4,$5)`, chain, header.Hash, market.MarketID, index, payload); err != nil {
			return fail(errors.New("cannot persist discovered market"))
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE tickergarden.discovery_checkpoints SET tip_number=$2,tip_hash=$3,updated_at=now() WHERE chain_id=$1`, chain, next, header.Hash); err != nil {
		return fail(errors.New("cannot advance discovery checkpoint"))
	}
	if err = tx.Commit(ctx); err != nil {
		return fail(errors.New("cannot commit discovery batch"))
	}
	return Result{Action: "discovered", BlockNumber: &next, Markets: len(markets)}, nil
}
