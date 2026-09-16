package discovery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/errgroup"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

// advanceEmptyBatch is an optional backfill optimization. Every included block
// remains receipt-checked against the RPC and journal; every creation block is
// left to DiscoverBlock with its exact-block runtime authentication. Empty runs
// authenticate core bindings at both boundaries, not at every intermediate
// block. They do not attest continuous runtime identity in event-free blocks.
func (w *Worker) advanceEmptyBatch(ctx context.Context, tx pgx.Tx, manifest deployment.Manifest, first chainrpc.Header, finalized uint64) (Result, bool, error) {
	fail := func(e error) (Result, bool, error) { return Result{}, false, e }
	if w.EmptyBatchSize < 2 {
		return Result{}, false, nil
	}
	start, e := first.Height()
	if e != nil {
		return fail(e)
	}
	end := start + w.EmptyBatchSize - 1
	if end > finalized {
		end = finalized
	}
	rows, e := tx.Query(ctx, `SELECT number,hash,parent_hash,block_timestamp FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND events_verified AND block_timestamp IS NOT NULL AND number BETWEEN $2 AND $3 ORDER BY number`, manifest.ChainID, start, end)
	if e != nil {
		return fail(errors.New("cannot load empty discovery range"))
	}
	var headers []chainrpc.Header
	for rows.Next() {
		var n, t uint64
		var h chainrpc.Header
		if e = rows.Scan(&n, &h.Hash, &h.ParentHash, &t); e != nil {
			rows.Close()
			return fail(e)
		}
		h.Number = fmt.Sprintf("0x%x", n)
		h.Timestamp = fmt.Sprintf("0x%x", t)
		headers = append(headers, h)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return fail(e)
	}
	var factory string
	for _, c := range manifest.Contracts {
		if c.Module == "TickerGardenFactoryV1" {
			factory = c.Address
		}
	}
	if factory == "" {
		return fail(errors.New("missing discovery factory"))
	}
	topic := deployment.Hash([]byte("MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)"))
	// Receipt-backed observations are independent, immutable RPC reads. Fetch
	// them with a small bound so a healthy public endpoint can validate a full
	// empty batch inside the worker deadline. Database comparisons and
	// checkpoint advancement remain ordered below.
	observations := make([]chainrpc.Observation, len(headers))
	group, child := errgroup.WithContext(ctx)
	group.SetLimit(8)
	for i, h := range headers {
		i, h := i, h
		group.Go(func() error {
			observed, err := w.RPC.Observe(child, h)
			if err == nil {
				observations[i] = observed
			}
			return err
		})
	}
	if err := group.Wait(); err != nil {
		return fail(err)
	}
	var accepted []chainrpc.Header
	for i, h := range headers {
		n, _ := h.Height()
		if n != start+uint64(len(accepted)) {
			return fail(errors.New("empty discovery range has a gap"))
		}
		if len(accepted) == 0 {
			if h != first {
				return fail(errors.New("empty discovery first header changed"))
			}
		} else {
			previous := accepted[len(accepted)-1]
			a, _ := previous.Time()
			b, _ := h.Time()
			if h.ParentHash != previous.Hash || b < a {
				return fail(errors.New("empty discovery parent or timestamp mismatch"))
			}
		}
		observed := observations[i]
		logs, err := tx.Query(ctx, `SELECT payload FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2 ORDER BY log_index`, manifest.ChainID, h.Hash)
		if err != nil {
			return fail(err)
		}
		journalLogs := make([]chainrpc.Log, 0)
		for logs.Next() {
			var raw []byte
			var l chainrpc.Log
			if err = logs.Scan(&raw); err == nil {
				err = json.Unmarshal(raw, &l)
			}
			if err != nil {
				logs.Close()
				return fail(err)
			}
			journalLogs = append(journalLogs, l)
		}
		err = logs.Err()
		logs.Close()
		if err != nil {
			return fail(err)
		}
		if len(observed.Logs) != len(journalLogs) {
			return fail(errors.New("empty discovery receipt log count mismatch"))
		}
		creation := false
		for i, l := range journalLogs {
			if !reflect.DeepEqual(l, observed.Logs[i]) {
				return fail(errors.New("empty discovery journal differs from receipts"))
			}
			if strings.EqualFold(l.Address, factory) && len(l.Topics) > 0 && strings.EqualFold(l.Topics[0], topic) {
				creation = true
			}
		}
		if creation {
			break
		}
		accepted = append(accepted, h)
	}
	if len(accepted) == 0 {
		return Result{}, false, nil
	}
	if _, e = deployment.VerifyCoreBindings(ctx, w.RPC, manifest, accepted[0]); e != nil {
		return fail(e)
	}
	last := accepted[len(accepted)-1]
	if len(accepted) > 1 {
		if _, e = deployment.VerifyCoreBindings(ctx, w.RPC, manifest, last); e != nil {
			return fail(e)
		}
	}
	// Verify both canonical boundaries after the complete observation. Parent links
	// bind every intermediate header to these finalized endpoints.
	for _, h := range []chainrpc.Header{accepted[0], last} {
		current, err := w.RPC.Header(ctx, h.Number)
		if err != nil {
			return fail(err)
		}
		if current != h {
			return fail(errors.New("empty discovery canonical boundary changed"))
		}
	}
	hashes := make([]string, len(accepted))
	for i, h := range accepted {
		hashes[i] = h.Hash
	}
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) SELECT $1,unnest($2::text[])`, manifest.ChainID, hashes); e != nil {
		return fail(errors.New("cannot persist empty discovery batches"))
	}
	n, _ := last.Height()
	if _, e = tx.Exec(ctx, `UPDATE tickergarden.discovery_checkpoints SET tip_number=$2,tip_hash=$3,updated_at=now() WHERE chain_id=$1`, manifest.ChainID, n, last.Hash); e != nil {
		return fail(errors.New("cannot advance empty discovery checkpoint"))
	}
	if e = tx.Commit(ctx); e != nil {
		return fail(errors.New("cannot commit empty discovery batch"))
	}
	return Result{Action: "discovered_empty_batch", BlockNumber: &n, Blocks: uint64(len(accepted))}, true, nil
}
