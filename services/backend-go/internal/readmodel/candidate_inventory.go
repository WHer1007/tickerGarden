package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// requireInput checks receipt logs against the final locally bound inventory.
// Unknown addresses and undeclared topics are outside the frozen projection ABI.
// A known topic with invalid encoding must fail, rather than disappear as unknown.
func (b *candidateEmitterBindings) requireInput(log chainrpc.Log, inputs map[string]string) error {
	binding, ok := b.addresses[log.Address]
	if !ok {
		return nil
	}
	_, err := events.Decode(binding.module, log)
	if errors.Is(err, events.ErrUnknown) {
		return nil
	}
	bad := errors.New("candidate protocol event inventory incomplete")
	height, e := strconv.ParseUint(log.BlockNumber, 0, 64)
	if err != nil || e != nil || height < binding.from || inputs[log.BlockHash+":"+log.LogIndex] != binding.module {
		return bad
	}
	return nil
}

// The caller has already verified these rows against complete receipt sets in
// this same read-only transaction. This reverse pass catches omitted inputs even
// when the checkpoint input_count was reduced to match the omission.
func (s *ObservationStore) verifyCandidateInventory(ctx context.Context, tx pgx.Tx, end uint64, bindings *candidateEmitterBindings, inputs map[string]string) error {
	bad := errors.New("candidate protocol event inventory incomplete")
	rows, e := tx.Query(ctx, `SELECT l.payload FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE l.chain_id=$1 AND b.canonical AND b.events_verified AND b.number BETWEEN $2 AND $3 ORDER BY b.number,l.log_index LIMIT 100001`, s.ChainID, s.StartBlock, end)
	if e != nil {
		return bad
	}
	defer rows.Close()
	count, size := 0, 0
	for rows.Next() {
		var raw []byte
		if rows.Scan(&raw) != nil {
			return bad
		}
		count++
		size += len(raw)
		var log chainrpc.Log
		if count > 100000 || size > 64<<20 || json.Unmarshal(raw, &log) != nil || bindings.requireInput(log, inputs) != nil {
			return bad
		}
	}
	if rows.Err() != nil {
		return bad
	}
	return nil
}
