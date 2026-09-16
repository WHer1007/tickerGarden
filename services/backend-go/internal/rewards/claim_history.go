package rewards

import (
	"context"
	"encoding/json"
	"math/big"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

// ClaimsFromInputs rebuilds observed payments only. Conversion and liability
// events never count as a payment. The caller verifies input provenance and order.
func ClaimsFromInputs(inputs []projection.Input) ([]ClaimTotal, error) {
	accumulator := newClaimAccumulator()
	for _, input := range inputs {
		if e := accumulator.add(input); e != nil {
			return nil, e
		}
	}
	return accumulator.result(), nil
}

// Keep only claim identities and totals, never the entire decoded block history.
// The event-key set preserves duplicate detection across the streamed rows.
type claimAccumulator struct {
	totals map[string]ClaimTotal
	seen   map[string]bool
}

func newClaimAccumulator() *claimAccumulator {
	return &claimAccumulator{totals: map[string]ClaimTotal{}, seen: map[string]bool{}}
}
func (c *claimAccumulator) add(input projection.Input) error {
	d, e := events.Decode(input.Module, input.Log)
	if e != nil {
		return ErrUnavailable
	}
	if !strings.HasPrefix(d.Signature, "FeeClaimed(") {
		return nil
	}
	index, e := chainrpc.Quantity(input.Log.LogIndex)
	if e != nil {
		return ErrUnavailable
	}
	eventKey := strconv.FormatUint(input.ChainID, 10) + ":" + input.Log.TransactionHash + ":" + strconv.FormatUint(index, 10)
	if c.seen[eventKey] || input.Log.Removed {
		return ErrUnavailable
	}
	a := d.Args
	total := ClaimTotal{MarketID: text(a, "marketId"), FeeAsset: text(a, "feeAsset"), Role: text(a, "beneficiaryType"), User: text(a, "beneficiary"), Epoch: text(a, "beneficiaryEpoch"), Amount: text(a, "amount"), Count: "1", First: eventKey}
	key := identity(total.MarketID, total.FeeAsset, total.Role, total.User, total.Epoch)
	if old, ok := c.totals[key]; ok {
		amount, _ := new(big.Int).SetString(old.Amount, 10)
		next, _ := new(big.Int).SetString(total.Amount, 10)
		count, _ := new(big.Int).SetString(old.Count, 10)
		total.Amount = amount.Add(amount, next).String()
		total.Count = count.Add(count, big.NewInt(1)).String()
		total.First = old.First
	}
	c.seen[eventKey] = true
	c.totals[key] = total
	return nil
}
func (c *claimAccumulator) result() []ClaimTotal {
	keys := make([]string, 0, len(c.totals))
	for key := range c.totals {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]ClaimTotal, 0, len(keys))
	for _, key := range keys {
		result = append(result, c.totals[key])
	}
	return result
}

// verifyClaimHistory compares all stored inputs with their original journal logs
// inside the same read transaction. It is bounded, and does not certify RPC
// collection completeness or the correctness of the deployment start.
func verifyClaimHistory(ctx context.Context, tx pgx.Tx, chain, start, end, expected uint64, endHash string) ([]ClaimTotal, error) {
	if expected > 100000 || end < start || end-start >= 1000000 {
		return nil, ErrUnavailable
	}
	if verifyJournalRange(ctx, tx, chain, start, end, endHash) != nil {
		return nil, ErrUnavailable
	}
	rows, e := tx.Query(ctx, `SELECT p.payload,p.digest,l.payload,b.number,b.hash,p.log_index
 FROM tickergarden.projection_inputs p
 JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.block_hash
 LEFT JOIN tickergarden.chain_logs l ON l.chain_id=p.chain_id AND l.block_hash=p.block_hash AND l.log_index=p.log_index
 WHERE p.chain_id=$1 AND b.canonical AND b.receipts_verified AND b.number BETWEEN $2 AND $3
 ORDER BY b.number,p.log_index LIMIT 100001`, chain, start, end)
	if e != nil {
		return nil, ErrUnavailable
	}
	defer rows.Close()
	accumulator := newClaimAccumulator()
	var count uint64
	size := 0
	for rows.Next() {
		var raw, source []byte
		var digest, hash string
		var height, index uint64
		if rows.Scan(&raw, &digest, &source, &height, &hash, &index) != nil {
			return nil, ErrUnavailable
		}
		size += len(raw) + len(source)
		if count >= 100000 || size > 64<<20 {
			return nil, ErrUnavailable
		}
		var in projection.Input
		var log chainrpc.Log
		if deployment.Hash(raw) != digest || json.Unmarshal(raw, &in) != nil || json.Unmarshal(source, &log) != nil || in.ChainID != chain || !reflect.DeepEqual(in.Log, log) || log.Removed || log.BlockHash != hash || log.BlockNumber != "0x"+strconv.FormatUint(height, 16) || log.LogIndex != "0x"+strconv.FormatUint(index, 16) {
			return nil, ErrUnavailable
		}
		if accumulator.add(in) != nil {
			return nil, ErrUnavailable
		}
		count++
	}
	if rows.Err() != nil || count != expected {
		return nil, ErrUnavailable
	}
	return accumulator.result(), nil
}
