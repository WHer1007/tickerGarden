package journal

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"reflect"
	"strconv"
	"tickergarden/backend/internal/chainrpc"
)

// VerifyStoredReceiptHistory checks the complete configured canonical range,
// receipt commitments and exact log inventory. The returned flag additionally
// requires every stored root to bind to the same receipt commitment.
// It does not authenticate consensus or prove that start precedes deployment.
func VerifyStoredReceiptHistory(ctx context.Context, tx pgx.Tx, chain, start, end uint64, genesis, endHash string) (bool, error) {
	bad := errors.New("stored receipt history incomplete")
	if end < start || end-start >= 1000000 {
		return false, bad
	}
	type block struct {
		number   uint64
		count    int
		logs     int
		digest   string
		receipts []chainrpc.Receipt
	}
	rootCovered := true
	blocks := map[string]*block{}
	rows, e := tx.Query(ctx, `SELECT number,hash,parent_hash,block_timestamp,receipt_count,receipt_set_hash,receipts_root,root_receipt_set_hash FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND events_verified AND number BETWEEN $2 AND $3 ORDER BY number LIMIT 1000001`, chain, start, end)
	if e != nil {
		return false, bad
	}
	var next = start
	var previous string
	var previousTime uint64
	for rows.Next() {
		var n, t uint64
		var hash, parent, digest string
		var count int
		var root, rootDigest *string
		if rows.Scan(&n, &hash, &parent, &t, &count, &digest, &root, &rootDigest) != nil || n != next || !receiptRootPattern.MatchString(hash) || !receiptRootPattern.MatchString(parent) || count < 0 || count > 16384 {
			rows.Close()
			return false, bad
		}
		if n > start && (parent != previous || t < previousTime) {
			rows.Close()
			return false, bad
		}
		if n == 0 && hash != genesis || n == 1 && start == 1 && parent != genesis {
			rows.Close()
			return false, bad
		}
		if root == nil || rootDigest == nil {
			rootCovered = false
		} else if !receiptRootPattern.MatchString(*root) || *rootDigest != digest {
			rows.Close()
			return false, bad
		}
		blocks[hash] = &block{number: n, count: count, digest: digest, receipts: []chainrpc.Receipt{}}
		previous = hash
		previousTime = t
		next++
	}
	if rows.Err() != nil || next != end+1 || previous != endHash {
		rows.Close()
		return false, bad
	}
	rows.Close()
	rows, e = tx.Query(ctx, `SELECT r.block_hash,r.transaction_hash,r.transaction_index,r.status,r.payload FROM tickergarden.chain_receipts r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=$1 AND b.canonical AND b.number BETWEEN $2 AND $3 ORDER BY b.number,r.transaction_index LIMIT 100001`, chain, start, end)
	if e != nil {
		return false, bad
	}
	expectedLogs := map[string]chainrpc.Log{}
	total, size := 0, 0
	for rows.Next() {
		var hash, th, status string
		var ti uint64
		var raw []byte
		if rows.Scan(&hash, &th, &ti, &status, &raw) != nil {
			rows.Close()
			return false, bad
		}
		total++
		size += len(raw)
		b := blocks[hash]
		var receipt chainrpc.Receipt
		if total > 100000 || size > 64<<20 || b == nil || json.Unmarshal(raw, &receipt) != nil || ti != uint64(len(b.receipts)) || receipt.BlockHash != hash || receipt.BlockNumber != "0x"+strconv.FormatUint(b.number, 16) || receipt.TransactionHash != th || receipt.TransactionIndex != "0x"+strconv.FormatUint(ti, 16) || receipt.Status != status || chainrpc.ValidateTransactionReceipt(th, &receipt) != nil {
			rows.Close()
			return false, bad
		}
		b.receipts = append(b.receipts, receipt)
		for _, log := range receipt.Logs {
			if log.LogIndex != "0x"+strconv.FormatInt(int64(b.logs), 16) {
				rows.Close()
				return false, bad
			}
			b.logs++
			key := hash + ":" + log.LogIndex
			if _, ok := expectedLogs[key]; ok || len(expectedLogs) >= 100000 {
				rows.Close()
				return false, bad
			}
			expectedLogs[key] = log
		}
	}
	if rows.Err() != nil {
		rows.Close()
		return false, bad
	}
	rows.Close()
	for _, b := range blocks {
		digest, e := chainrpc.ReceiptSetCommitment(b.receipts)
		if e != nil || len(b.receipts) != b.count || digest != b.digest {
			return false, bad
		}
	}
	rows, e = tx.Query(ctx, `SELECT l.block_hash,l.log_index,l.address,l.payload FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE l.chain_id=$1 AND b.canonical AND b.number BETWEEN $2 AND $3 LIMIT 100001`, chain, start, end)
	if e != nil {
		return false, bad
	}
	defer rows.Close()
	for rows.Next() {
		var hash, address string
		var index uint64
		var raw []byte
		if rows.Scan(&hash, &index, &address, &raw) != nil {
			return false, bad
		}
		size += len(raw)
		if size > 64<<20 {
			return false, bad
		}
		var log chainrpc.Log
		if json.Unmarshal(raw, &log) != nil {
			return false, bad
		}
		key := hash + ":0x" + strconv.FormatUint(index, 16)
		expected, ok := expectedLogs[key]
		if !ok || address != log.Address || !reflect.DeepEqual(log, expected) {
			return false, bad
		}
		delete(expectedLogs, key)
	}
	if rows.Err() != nil || len(expectedLogs) != 0 {
		return false, bad
	}
	return rootCovered, nil
}
