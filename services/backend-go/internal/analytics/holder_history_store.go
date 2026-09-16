package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
)

// ReadCommittedTransferRange must use the caller's repeatable-read transaction.
// It checks a canonical finalized range and durable receipt commitments. The
// caller must also bind chain genesis, token identity and the creation boundary;
// a valid arbitrary interval is not necessarily complete token history.
func ReadCommittedTransferRange(ctx context.Context, tx pgx.Tx, chain uint64, token string, first, last uint64) ([]HolderTransfer, error) {
	if tx == nil || !addressRE.MatchString(token) || first > last || last > math.MaxInt64 || last-first >= 1000000 {
		return nil, ErrHolders
	}
	rows, err := tx.Query(ctx, `SELECT b.number,b.hash,b.parent_hash,b.block_timestamp,b.receipt_count,b.receipt_set_hash
 FROM tickergarden.chain_blocks b JOIN tickergarden.chain_journal j ON j.chain_id=b.chain_id
 WHERE b.chain_id=$1 AND b.canonical AND b.receipts_verified AND b.number BETWEEN $2 AND $3 AND j.finalized_number>=$3 ORDER BY b.number`, chain, first, last)
	if err != nil {
		return nil, err
	}
	blocks := []CommittedReceiptBlock{}
	byHash := map[string]int{}
	next := first
	var prior string
	var priorTime uint64
	for rows.Next() {
		var n, ts uint64
		var b CommittedReceiptBlock
		var parent string
		if rows.Scan(&n, &b.Hash, &parent, &ts, &b.ReceiptCount, &b.ReceiptSetHash) != nil || n != next || !hashRE.MatchString(parent) || (next > first && (parent != prior || ts < priorTime)) {
			rows.Close()
			return nil, ErrHolders
		}
		b.Number = strconv.FormatUint(n, 10)
		b.Receipts = []chainrpc.Receipt{}
		byHash[b.Hash] = len(blocks)
		blocks = append(blocks, b)
		prior = b.Hash
		priorTime = ts
		next++
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if next != last+1 {
		return nil, ErrHolders
	}
	rows, err = tx.Query(ctx, `SELECT r.block_hash,r.transaction_hash,r.transaction_index,r.status,r.payload FROM tickergarden.chain_receipts r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=$1 AND b.canonical AND b.number BETWEEN $2 AND $3 ORDER BY b.number,r.transaction_index`, chain, first, last)
	if err != nil {
		return nil, err
	}
	budget := 0
	count := 0
	for rows.Next() {
		var bh, th, status string
		var index uint64
		var raw []byte
		if rows.Scan(&bh, &th, &index, &status, &raw) != nil {
			rows.Close()
			return nil, ErrHolders
		}
		budget += len(raw)
		count++
		if budget > 64<<20 || count > 100000 {
			rows.Close()
			return nil, ErrHolders
		}
		var r chainrpc.Receipt
		i, ok := byHash[bh]
		if !ok || json.Unmarshal(raw, &r) != nil || r.BlockHash != bh || r.TransactionHash != th || r.TransactionIndex != fmt.Sprintf("0x%x", index) || r.Status != status {
			rows.Close()
			return nil, ErrHolders
		}
		blocks[i].Receipts = append(blocks[i].Receipts, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = tx.Query(ctx, `SELECT l.block_hash,l.log_index,l.payload FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE l.chain_id=$1 AND b.canonical AND b.number BETWEEN $2 AND $3 AND l.address=$4 ORDER BY b.number,l.log_index`, chain, first, last, token)
	if err != nil {
		return nil, err
	}
	logs := []chainrpc.Log{}
	for rows.Next() {
		var bh string
		var index uint64
		var raw []byte
		if rows.Scan(&bh, &index, &raw) != nil {
			rows.Close()
			return nil, ErrHolders
		}
		budget += len(raw)
		if budget > 64<<20 || len(logs) >= 100000 {
			rows.Close()
			return nil, ErrHolders
		}
		var l chainrpc.Log
		if json.Unmarshal(raw, &l) != nil || l.BlockHash != bh || l.LogIndex != fmt.Sprintf("0x%x", index) {
			rows.Close()
			return nil, ErrHolders
		}
		logs = append(logs, l)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return DecodeCommittedHolderTransfers(chain, token, blocks, logs)
}
