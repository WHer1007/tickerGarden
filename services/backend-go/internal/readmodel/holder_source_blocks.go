package readmodel

import (
	"context"
	"errors"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
)

// Collect unique historical source identities before a single database lookup.
// A reset/NONE epoch has no source; every requested or later epoch retains one.
func holderSourceBlocks(holders []HolderMarketCandidate) (map[uint64]string, error) {
	bad := errors.New("invalid Holder source block inventory")
	out := map[uint64]string{}
	zero := "0x0000000000000000000000000000000000000000000000000000000000000000"
	count := 0
	for _, h := range holders {
		if h.Mode != "epoch" {
			continue
		}
		if h.Epoch == nil {
			return nil, bad
		}
		for _, entry := range h.Epoch.Entries {
			count++
			if count > deployment.MaxHolderEpochReads {
				return nil, bad
			}
			v := entry.Values
			status, e := strconv.ParseUint(v["status"], 10, 8)
			if e != nil || status > 4 || strconv.FormatUint(status, 10) != v["status"] {
				return nil, bad
			}
			n, e := strconv.ParseUint(v["sourceBlockNumber"], 10, 63)
			if e != nil || strconv.FormatUint(n, 10) != v["sourceBlockNumber"] || !candidateHash.MatchString(v["sourceBlockHash"]) {
				return nil, bad
			}
			hash := v["sourceBlockHash"]
			if status == 0 {
				if n != 0 || hash != zero || v["requestedAt"] != "0" {
					return nil, bad
				}
				continue
			}
			if hash == zero {
				return nil, bad
			}
			if previous, ok := out[n]; ok && previous != hash {
				return nil, bad
			}
			out[n] = hash
		}
	}
	return out, nil
}

// Run in the same repeatable-read transaction as candidate assembly/finality.
// Missing indexed history is unavailable evidence, never an implicit match.
func (s *ObservationStore) verifyHolderSourceBlocks(ctx context.Context, tx pgx.Tx, holders []HolderMarketCandidate, history ...[]holderRequestSource) error {
	bad := errors.New("Holder source block is not verified canonical history")
	expected, e := holderSourceBlocks(holders)
	if e != nil {
		return e
	}
	if len(history) > 1 {
		return bad
	}
	if len(history) == 1 {
		distributors := map[string]bool{}
		for _, holder := range holders {
			if holder.Mode == "epoch" {
				distributors[holder.Distributor] = true
			}
		}
		for _, request := range history[0] {
			if !distributors[request.distributor] {
				continue
			}
			if request.source > 1<<63-1 || !candidateHash.MatchString(request.hash) {
				return bad
			}
			if previous, exists := expected[request.source]; exists && previous != request.hash {
				return bad
			}
			expected[request.source] = request.hash
			if len(expected) > 100000 {
				return bad
			}
		}
	}
	if len(expected) == 0 {
		return nil
	}
	heights := make([]int64, 0, len(expected))
	for n := range expected {
		heights = append(heights, int64(n))
	}
	sort.Slice(heights, func(i, j int) bool { return heights[i] < heights[j] })
	rows, e := tx.Query(ctx, `SELECT b.number,b.hash FROM tickergarden.chain_blocks b
 JOIN tickergarden.chain_journal j ON j.chain_id=b.chain_id
 WHERE b.chain_id=$1 AND b.number=ANY($2::bigint[]) AND b.canonical
 AND b.events_verified AND b.number<=j.finalized_number`, s.ChainID, heights)
	if e != nil {
		return bad
	}
	defer rows.Close()
	for rows.Next() {
		var n uint64
		var hash string
		if rows.Scan(&n, &hash) != nil || expected[n] != hash {
			return bad
		}
		delete(expected, n)
	}
	if rows.Err() != nil || len(expected) != 0 {
		return bad
	}
	return nil
}
