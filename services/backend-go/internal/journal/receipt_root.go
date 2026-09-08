package journal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
)

// VerifyStoredReceiptRoot checks the persisted root-to-receipt-set binding in
// the caller's snapshot. It does not reauthenticate the header via consensus.
func VerifyStoredReceiptRoot(ctx context.Context, tx pgx.Tx, chain, number uint64, hash string) error {
	bad := errors.New("stored receipt root evidence unavailable or mismatched")
	var root, digest, bound string
	var count int
	if tx.QueryRow(ctx, `SELECT receipts_root,receipt_set_hash,root_receipt_set_hash,receipt_count FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND hash=$3 AND canonical AND receipts_verified`, chain, number, hash).Scan(&root, &digest, &bound, &count) != nil || !receiptRootPattern.MatchString(root) || digest != bound || count < 0 || count > 16384 {
		return bad
	}
	rows, err := tx.Query(ctx, `SELECT transaction_hash,transaction_index,status,payload FROM tickergarden.chain_receipts WHERE chain_id=$1 AND block_hash=$2 ORDER BY transaction_index LIMIT 16385`, chain, hash)
	if err != nil {
		return bad
	}
	defer rows.Close()
	accumulator := chainrpc.NewReceiptSetAccumulator()
	seen := 0
	for rows.Next() {
		var txHash, status string
		var index uint64
		var raw []byte
		if rows.Scan(&txHash, &index, &status, &raw) != nil || seen >= count || len(raw) > 32<<20 {
			return bad
		}
		var receipt chainrpc.Receipt
		if json.Unmarshal(raw, &receipt) != nil || chainrpc.ValidateTransactionReceipt(txHash, &receipt) != nil || receipt.BlockHash != hash || receipt.BlockNumber != fmt.Sprintf("0x%x", number) || index != uint64(seen) || receipt.TransactionIndex != fmt.Sprintf("0x%x", index) || receipt.Status != status {
			return bad
		}
		if accumulator.Add(receipt) != nil {
			return bad
		}
		seen++
	}
	if rows.Err() != nil || seen != count || accumulator.Sum() != bound {
		return bad
	}
	return nil
}
