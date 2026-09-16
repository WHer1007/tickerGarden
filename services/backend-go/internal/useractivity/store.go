package useractivity

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

const Version = "user-event-roles-v1"

var canonicalHash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

// IndexBlock participates in the caller's transaction and chain lease. The
// caller must roll back on any error. Missing old block batches remain missing;
// a new tip must never be mistaken for proof of historical index completeness.
func IndexBlock(ctx context.Context, tx pgx.Tx, chain uint64, header chainrpc.Header, manifest string, verified deployment.Verified) error {
	if (chain != 4663 && chain != 46630 && chain != 421614) || verified.CheckScope(chain, header.Hash) != nil || tx == nil || !canonicalHash.MatchString(header.Hash) || !canonicalHash.MatchString(manifest) {
		return ErrEvidence
	}
	height, err := header.Height()
	if err != nil || height > math.MaxInt64 {
		return ErrEvidence
	}
	var count int
	var commitment string
	if err = tx.QueryRow(ctx, `SELECT b.receipt_count,b.receipt_set_hash FROM tickergarden.chain_blocks b JOIN tickergarden.chain_journal j ON j.chain_id=b.chain_id WHERE b.chain_id=$1 AND b.hash=$2 AND b.number=$3 AND b.canonical AND b.events_verified AND b.number<=j.finalized_number`, chain, header.Hash, height).Scan(&count, &commitment); err != nil {
		return fmt.Errorf("activity receipt commitment unavailable: %w", err)
	}
	if count < 0 || count > 16384 {
		return ErrEvidence
	}
	rows, err := tx.Query(ctx, `SELECT transaction_hash,transaction_index,status,CASE WHEN octet_length(payload::text)<=33554432 THEN payload ELSE NULL END FROM tickergarden.chain_receipts WHERE chain_id=$1 AND block_hash=$2 ORDER BY transaction_index LIMIT 16385`, chain, header.Hash)
	if err != nil {
		return err
	}
	receipts := []chainrpc.Receipt{}
	budget := 0
	for rows.Next() {
		var hash, status string
		var index uint64
		var raw []byte
		if err = rows.Scan(&hash, &index, &status, &raw); err != nil {
			break
		}
		budget += len(raw)
		if budget > 32<<20 || len(receipts) >= 16384 {
			err = ErrEvidence
			break
		}
		var r chainrpc.Receipt
		if json.Unmarshal(raw, &r) != nil || index != uint64(len(receipts)) || r.TransactionHash != hash || r.TransactionIndex != fmt.Sprintf("0x%x", index) || r.Status != status || r.BlockHash != header.Hash || r.BlockNumber != header.Number || chainrpc.ValidateTransactionReceipt(hash, &r) != nil {
			err = ErrEvidence
			break
		}
		receipts = append(receipts, r)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	digest, err := chainrpc.ReceiptSetCommitment(receipts)
	if err != nil || len(receipts) != count || digest != commitment {
		return ErrEvidence
	}
	records := []Record{}
	for i := range receipts {
		extracted, e := FromVerifiedReceipt(ctx, chain, verified, &receipts[i])
		if e != nil {
			return e
		}
		if len(records)+len(extracted) > 100000 {
			return ErrEvidence
		}
		records = append(records, extracted...)
	}
	payloads := make([][]byte, len(records))
	hasher := sha256.New()
	hasher.Write([]byte("tickergarden-user-activity-v1\n"))
	budget = 0
	for i, r := range records {
		data, e := json.Marshal(r)
		if e != nil {
			return e
		}
		budget += len(data)
		if budget > 64<<20 {
			return ErrEvidence
		}
		payloads[i] = data
		hasher.Write(data)
		hasher.Write([]byte{'\n'})
	}
	recordsHash := "sha256:" + hex.EncodeToString(hasher.Sum(nil))
	if _, err = tx.Exec(ctx, `INSERT INTO tickergarden.user_activity_blocks(chain_id,block_hash,manifest_hash,extractor_version,receipt_set_hash,record_count,records_hash) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(chain_id,block_hash) DO UPDATE SET manifest_hash=EXCLUDED.manifest_hash,extractor_version=EXCLUDED.extractor_version,receipt_set_hash=EXCLUDED.receipt_set_hash,record_count=EXCLUDED.record_count,records_hash=EXCLUDED.records_hash,indexed_at=now()`, chain, header.Hash, manifest, Version, commitment, len(records), recordsHash); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM tickergarden.user_activity_records WHERE chain_id=$1 AND block_hash=$2`, chain, header.Hash); err != nil {
		return err
	}
	_, err = tx.CopyFrom(ctx, pgx.Identifier{"tickergarden", "user_activity_records"}, []string{"chain_id", "block_hash", "account", "block_number", "transaction_index", "log_index", "payload"}, pgx.CopyFromSlice(len(records), func(i int) ([]any, error) {
		r := records[i]
		ti, e := strconv.ParseInt(r.TransactionIndex, 10, 64)
		if e != nil {
			return nil, e
		}
		li, e := strconv.ParseInt(r.LogIndex, 10, 64)
		if e != nil {
			return nil, e
		}
		return []any{chain, r.BlockHash, r.Account, height, ti, li, json.RawMessage(payloads[i])}, nil
	}))
	return err
}
