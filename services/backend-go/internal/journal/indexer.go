// Package journal persists raw canonical chain observations. It does not publish
// protocol balances or attest that RPC logs have been independently reconciled.
package journal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
)

type RPC interface {
	ChainID(context.Context) (uint64, error)
	Header(context.Context, string) (chainrpc.Header, error)
	Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error)
}
type Indexer struct {
	Pool                *pgxpool.Pool
	RPC                 RPC
	ChainID             uint64
	StartBlock          uint64
	MaxReorg            uint64
	RequireReceiptRoot  bool
	AllowEventExclusion bool
}
type Result struct {
	Action      string  `json:"action"`
	BlockNumber *uint64 `json:"blockNumber,omitempty"`
	Logs        int     `json:"logs"`
}

var receiptRootPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

func tag(n uint64) string   { return fmt.Sprintf("0x%x", n) }
func same(a, b string) bool { return strings.EqualFold(a, b) }

// Step atomically commits one block or one bounded reorganization. A transaction
// advisory lock serializes writers across processes. No cursor moves on errors.
func (i *Indexer) Step(ctx context.Context) (Result, error) {
	fail := func(err error) (Result, error) { return Result{}, err }
	if i.Pool == nil || i.RPC == nil || (i.ChainID != 4663 && i.ChainID != 46630 && i.ChainID != 421614) || i.StartBlock > 1<<63-1 || i.MaxReorg == 0 || i.MaxReorg > 1024 {
		return fail(errors.New("invalid indexer configuration"))
	}
	id, err := i.RPC.ChainID(ctx)
	if err != nil {
		return fail(err)
	}
	if id != i.ChainID {
		return fail(errors.New("RPC chain ID mismatch"))
	}
	genesis, err := i.RPC.Header(ctx, "0x0")
	if err != nil {
		return fail(err)
	}
	head, err := i.RPC.Header(ctx, "latest")
	if err != nil {
		return fail(err)
	}
	headN, err := head.Height()
	if err != nil {
		return fail(err)
	}
	final, err := i.RPC.Header(ctx, "finalized")
	if err != nil {
		return fail(err)
	}
	finalN, err := final.Height()
	if err != nil || finalN > headN {
		return fail(errors.New("invalid finalized head"))
	}
	canonicalFinal, err := i.RPC.Header(ctx, tag(finalN))
	if err != nil {
		return fail(err)
	}
	if !same(canonicalFinal.Hash, final.Hash) {
		return fail(errors.New("finalized header changed during observation"))
	}
	tx, err := i.Pool.Begin(ctx)
	if err != nil {
		return fail(errors.New("cannot begin journal transaction"))
	}
	defer tx.Rollback(context.Background())
	var locked bool
	if err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock($1)", int64(730000000+i.ChainID)).Scan(&locked); err != nil {
		return fail(errors.New("cannot acquire journal lock"))
	}
	if !locked {
		return Result{Action: "busy"}, nil
	}
	_, err = tx.Exec(ctx, `INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, i.ChainID, strings.ToLower(genesis.Hash), i.StartBlock)
	if err != nil {
		return fail(errors.New("cannot initialize journal; run migrations first"))
	}
	var savedGenesis string
	var start uint64
	var tipN, storedFinalN *uint64
	var tipHash, storedFinalHash *string
	err = tx.QueryRow(ctx, `SELECT genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash FROM tickergarden.chain_journal WHERE chain_id=$1 FOR UPDATE`, i.ChainID).Scan(&savedGenesis, &start, &tipN, &tipHash, &storedFinalN, &storedFinalHash)
	if err != nil {
		return fail(errors.New("cannot read journal checkpoint"))
	}
	if !same(savedGenesis, genesis.Hash) || start != i.StartBlock {
		return fail(errors.New("journal genesis or start block mismatch"))
	}
	if storedFinalN != nil {
		if finalN < *storedFinalN {
			return fail(errors.New("RPC finalized head regressed"))
		}
		h, e := i.RPC.Header(ctx, tag(*storedFinalN))
		if e != nil {
			return fail(e)
		}
		if !same(h.Hash, *storedFinalHash) {
			return fail(errors.New("finality violation: manual investigation required"))
		}
	}
	action := Result{Action: "idle"}
	if tipN != nil {
		if headN < *tipN {
			return fail(errors.New("RPC head is behind persisted checkpoint"))
		}
		h, e := i.RPC.Header(ctx, tag(*tipN))
		if e != nil {
			return fail(e)
		}
		if !same(h.Hash, *tipHash) {
			// Search before mutating. Crossing either finality or the configured range
			// is a hard stop, never an automatic deletion of trusted history.
			ancestor := *tipN
			found := false
			for depth := uint64(0); depth < i.MaxReorg && ancestor > start; depth++ {
				ancestor--
				var hash string
				if err = tx.QueryRow(ctx, `SELECT hash FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND canonical`, i.ChainID, ancestor).Scan(&hash); err != nil {
					return fail(errors.New("journal canonical history has a gap"))
				}
				remote, e := i.RPC.Header(ctx, tag(ancestor))
				if e != nil {
					return fail(e)
				}
				if same(hash, remote.Hash) {
					found = true
					tipHash = &hash
					break
				}
				if storedFinalN != nil && ancestor <= *storedFinalN {
					return fail(errors.New("reorganization crosses finalized checkpoint"))
				}
			}
			if !found {
				return fail(errors.New("reorganization exceeds configured depth or start boundary"))
			}
			if storedFinalN != nil && ancestor < *storedFinalN {
				return fail(errors.New("reorganization crosses finalized checkpoint"))
			}
			if _, err = tx.Exec(ctx, `UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=$1 AND canonical AND number>$2`, i.ChainID, ancestor); err != nil {
				return fail(errors.New("cannot orphan journal blocks"))
			}
			tipN = &ancestor
			action = Result{Action: "rewound", BlockNumber: tipN}
		}
	}
	if action.Action != "rewound" {
		next := start
		if tipN != nil {
			next = *tipN + 1
		}
		backfill := false
		var missing *uint64
		err = tx.QueryRow(ctx, `SELECT min(number) FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND (NOT events_verified OR block_timestamp IS NULL OR receipt_set_hash IS NULL OR ($2 AND receipts_root IS NULL AND NOT ($3 AND event_exclusion_header IS NOT NULL)))`, i.ChainID, i.RequireReceiptRoot, i.AllowEventExclusion).Scan(&missing)
		if err != nil {
			return fail(errors.New("cannot inspect block coverage"))
		}
		if missing != nil {
			next = *missing
			backfill = true
		}
		if next <= headN {
			h, e := i.RPC.Header(ctx, tag(next))
			if e != nil {
				return fail(e)
			}
			if !backfill && tipHash != nil && !same(h.ParentHash, *tipHash) {
				return fail(errors.New("block parent changed; retry observation"))
			}
			timestamp, e := h.Time()
			if e != nil {
				return fail(e)
			}
			// Historical timestamps are commitments of the observed block. Never
			// overwrite an existing value, including during receipt backfill.
			var previous *uint64
			e = tx.QueryRow(ctx, `SELECT block_timestamp FROM tickergarden.chain_blocks WHERE chain_id=$1 AND hash=$2`, i.ChainID, strings.ToLower(h.Hash)).Scan(&previous)
			if e != nil && !errors.Is(e, pgx.ErrNoRows) {
				return fail(errors.New("cannot inspect stored timestamp"))
			}
			if previous != nil && *previous != timestamp {
				return fail(errors.New("block timestamp differs from journal"))
			}
			var inconsistent bool
			e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND ((number=$2::bigint-1 AND block_timestamp>$3) OR (number=$2::bigint+1 AND block_timestamp<$3)))`, i.ChainID, int64(next), int64(timestamp)).Scan(&inconsistent)
			if e != nil {
				return fail(errors.New("cannot inspect timestamp sequence"))
			}
			if inconsistent {
				return fail(errors.New("non-monotonic journal timestamp"))
			}
			observation, e := i.RPC.Observe(ctx, h)
			logs := observation.Logs
			if errors.Is(e, ErrEventScopePending) {
				return Result{Action: "waiting_for_discovery"}, nil
			}
			if e != nil {
				return fail(e)
			}
			again, e := i.RPC.Header(ctx, tag(next))
			if e != nil {
				return fail(e)
			}
			if !same(h.Hash, again.Hash) || h.Timestamp != again.Timestamp || !same(h.ParentHash, again.ParentHash) {
				return fail(errors.New("block changed while fetching logs"))
			}
			if backfill {
				rows, e := tx.Query(ctx, `SELECT payload FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2 ORDER BY log_index`, i.ChainID, strings.ToLower(h.Hash))
				if e != nil {
					return fail(errors.New("cannot read historical logs"))
				}
				existing := []chainrpc.Log{}
				for rows.Next() {
					var payload []byte
					if e = rows.Scan(&payload); e != nil {
						rows.Close()
						return fail(errors.New("cannot scan historical logs"))
					}
					var log chainrpc.Log
					if e = json.Unmarshal(payload, &log); e != nil {
						rows.Close()
						return fail(errors.New("invalid historical log"))
					}
					existing = append(existing, log)
				}
				e = rows.Err()
				rows.Close()
				if e != nil {
					return fail(errors.New("cannot read complete historical log set"))
				}
				if !reflect.DeepEqual(existing, logs) {
					return fail(errors.New("historical logs differ from receipts; investigate before repairing journal"))
				}
			}
			commitment, e := chainrpc.ReceiptSetCommitment(observation.Receipts)
			if e != nil {
				return fail(e)
			}
			var receiptsRoot, rootCommitment *string
			var exclusion json.RawMessage
			fullReceipts := true
			if proof := observation.Exclusion; proof != nil {
				if !i.AllowEventExclusion || observation.RootProof != nil || len(observation.Logs) != 0 || len(observation.Receipts) != 0 || chainrpc.VerifyEventExclusion(proof.Header, h.Hash, proof.Emitters) != nil {
					return fail(errors.New("invalid event exclusion evidence"))
				}
				exclusion = proof.Header
				fullReceipts = false
			}
			if proof := observation.RootProof; proof != nil {
				if proof.BlockHash != h.Hash || !receiptRootPattern.MatchString(proof.ReceiptRoot) || proof.ReceiptSetHash != commitment || proof.ReceiptCount != len(observation.Receipts) {
					return fail(errors.New("receipt root evidence does not match observation"))
				}
				receiptsRoot, rootCommitment = &proof.ReceiptRoot, &proof.ReceiptSetHash
			} else if i.RequireReceiptRoot && exclusion == nil {
				return fail(errors.New("receipt root evidence required"))
			}
			var previousCommitment *string
			var previousCount *int
			e = tx.QueryRow(ctx, `SELECT receipt_set_hash,receipt_count FROM tickergarden.chain_blocks WHERE chain_id=$1 AND hash=$2`, i.ChainID, strings.ToLower(h.Hash)).Scan(&previousCommitment, &previousCount)
			if e != nil && !errors.Is(e, pgx.ErrNoRows) {
				return fail(e)
			}
			if previousCommitment != nil && (*previousCommitment != commitment || previousCount == nil || *previousCount != len(observation.Receipts)) {
				return fail(errors.New("receipt set differs from journal commitment"))
			}
			_, err = tx.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,receipts_verified,block_timestamp,receipt_count,receipt_set_hash,receipts_root,root_receipt_set_hash,event_exclusion_header) VALUES($1,$2,$3,$4,$10,$5,$6,$7,$8,$9,$11) ON CONFLICT(chain_id,hash) DO UPDATE SET canonical=true,receipts_verified=EXCLUDED.receipts_verified,event_exclusion_header=EXCLUDED.event_exclusion_header,block_timestamp=EXCLUDED.block_timestamp,receipt_count=EXCLUDED.receipt_count,receipt_set_hash=EXCLUDED.receipt_set_hash,receipts_root=EXCLUDED.receipts_root,root_receipt_set_hash=EXCLUDED.root_receipt_set_hash`, i.ChainID, next, strings.ToLower(h.Hash), strings.ToLower(h.ParentHash), int64(timestamp), len(observation.Receipts), commitment, receiptsRoot, rootCommitment, fullReceipts, exclusion)
			if err != nil {
				return fail(errors.New("cannot persist block"))
			}
			// Re-observing a previously orphaned hash replaces its entire raw log set.
			if _, err = tx.Exec(ctx, `DELETE FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2`, i.ChainID, strings.ToLower(h.Hash)); err != nil {
				return fail(errors.New("cannot replace block logs"))
			}
			for _, l := range logs {
				index, e := chainrpc.Quantity(l.LogIndex)
				if e != nil {
					return fail(e)
				}
				payload, e := json.Marshal(l)
				if e != nil {
					return fail(e)
				}
				_, err = tx.Exec(ctx, `INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,$3,$4,$5)`, i.ChainID, strings.ToLower(h.Hash), index, strings.ToLower(l.Address), payload)
				if err != nil {
					return fail(errors.New("cannot persist block log"))
				}
			}
			if _, err = tx.Exec(ctx, `DELETE FROM tickergarden.chain_receipts WHERE chain_id=$1 AND block_hash=$2`, i.ChainID, strings.ToLower(h.Hash)); err != nil {
				return fail(errors.New("cannot replace block receipts"))
			}
			for index, receipt := range observation.Receipts {
				payload, e := json.Marshal(receipt)
				if e != nil {
					return fail(e)
				}
				_, err = tx.Exec(ctx, `INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,$4,$5,$6)`, i.ChainID, strings.ToLower(h.Hash), strings.ToLower(receipt.TransactionHash), index, receipt.Status, payload)
				if err != nil {
					return fail(errors.New("cannot persist transaction receipt"))
				}
			}
			hash := strings.ToLower(h.Hash)
			if backfill {
				action = Result{Action: "receipts_verified", BlockNumber: &next, Logs: len(logs)}
			} else {
				tipN = &next
				tipHash = &hash
				action = Result{Action: "indexed", BlockNumber: tipN, Logs: len(logs)}
			}
		}
	}
	// A fast chain can move its finalized head faster than receipt verification.
	// In that case every ingested ancestor of the remote finalized block is also
	// finalized. Advance to the highest locally verified ancestor so downstream
	// workers can follow the journal without waiting for the indexer to catch the
	// moving head. The candidate is checked both in PostgreSQL and against RPC.
	if tipN != nil {
		candidateN := finalN
		candidateHash := strings.ToLower(final.Hash)
		if *tipN < candidateN {
			candidateN = *tipN
			remote, e := i.RPC.Header(ctx, tag(candidateN))
			if e != nil {
				return fail(e)
			}
			candidateHash = strings.ToLower(remote.Hash)
		}
		var localFinal string
		err = tx.QueryRow(ctx, `SELECT hash FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND canonical AND events_verified`, i.ChainID, candidateN).Scan(&localFinal)
		if err == nil {
			if !same(localFinal, candidateHash) {
				return fail(errors.New("finalized block differs from journal"))
			}
			if storedFinalN == nil || candidateN > *storedFinalN {
				storedFinalN = &candidateN
				storedFinalHash = &candidateHash
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return fail(errors.New("cannot read finalized checkpoint"))
		}
	}
	_, err = tx.Exec(ctx, `UPDATE tickergarden.chain_journal SET tip_number=$2,tip_hash=$3,finalized_number=$4,finalized_hash=$5,updated_at=now() WHERE chain_id=$1`, i.ChainID, tipN, tipHash, storedFinalN, storedFinalHash)
	if err != nil {
		return fail(errors.New("cannot update journal checkpoint"))
	}
	if err = tx.Commit(ctx); err != nil {
		return fail(errors.New("journal commit failed"))
	}
	return action, nil
}
