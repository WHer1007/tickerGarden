package transactions

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strconv"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"time"
)

type Store struct {
	Pool        *pgxpool.Pool
	ChainID     uint64
	GenesisHash string
}
type JournalStatus struct {
	Status
	Source        string    `json:"source"`
	IndexedFrom   string    `json:"indexedFrom"`
	ObservedAt    time.Time `json:"observedAt"`
	PendingLookup string    `json:"pendingLookup"`
}

// Load reports the indexed journal tip, not a separately fetched live RPC head.
// Unknown means not observed here; it does not establish absence from the mempool.
func (s *Store) Load(ctx context.Context, hash string) (JournalStatus, error) {
	fail := func() (JournalStatus, error) { return JournalStatus{}, ErrObservation }
	if s.Pool == nil || !hashPattern.MatchString(hash) || !hashPattern.MatchString(s.GenesisHash) {
		return fail()
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	o := Observation{ChainID: s.ChainID, TransactionHash: hash, Receipts: []ObservedReceipt{}}
	var start uint64
	var observed time.Time
	err = tx.QueryRow(ctx, `SELECT start_block,tip_number,tip_hash,finalized_number,finalized_hash,updated_at FROM tickergarden.chain_journal WHERE chain_id=$1 AND genesis_hash=$2 AND updated_at>=now()-interval '120 seconds' AND updated_at<=now()+interval '5 seconds'`, s.ChainID, s.GenesisHash).Scan(&start, &o.Head.Number, &o.Head.Hash, &o.Finalized.Number, &o.Finalized.Hash, &observed)
	if err != nil || start > o.Finalized.Number || o.Finalized.Number > o.Head.Number || o.Head.Number-start >= 1000000 {
		return fail()
	}
	rows, err := tx.Query(ctx, `SELECT number,hash,parent_hash,receipts_verified FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND number BETWEEN $2 AND $3 ORDER BY number`, s.ChainID, start, o.Head.Number)
	if err != nil {
		return fail()
	}
	next := start
	prior := ""
	finalSeen := false
	for rows.Next() {
		var n uint64
		var h, parent string
		var verified bool
		if rows.Scan(&n, &h, &parent, &verified) != nil || n != next || !verified || !hashPattern.MatchString(h) || !hashPattern.MatchString(parent) || (n > start && parent != prior) || (n == o.Head.Number && h != o.Head.Hash) {
			rows.Close()
			return fail()
		}
		if n == o.Finalized.Number {
			if h != o.Finalized.Hash {
				rows.Close()
				return fail()
			}
			finalSeen = true
		}
		prior = h
		next++
	}
	err = rows.Err()
	rows.Close()
	if err != nil || next != o.Head.Number+1 || !finalSeen {
		return fail()
	}
	rows, err = tx.Query(ctx, `SELECT b.hash,b.number,b.canonical,b.receipts_verified,b.receipt_count,b.receipt_set_hash FROM tickergarden.chain_receipts r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=$1 AND r.transaction_hash=$2 ORDER BY b.number,b.hash LIMIT 129`, s.ChainID, hash)
	if err != nil {
		return fail()
	}
	type block struct {
		hash      string
		number    uint64
		canonical bool
		count     int
		digest    string
	}
	blocks := []block{}
	for rows.Next() {
		var b block
		var verified bool
		if rows.Scan(&b.hash, &b.number, &b.canonical, &verified, &b.count, &b.digest) != nil || !verified || b.count < 1 || b.count > 16384 || (b.canonical && (b.number < start || b.number > o.Head.Number)) {
			rows.Close()
			return fail()
		}
		blocks = append(blocks, b)
	}
	err = rows.Err()
	rows.Close()
	if err != nil || len(blocks) > 128 {
		return fail()
	}
	total := 0
	for _, b := range blocks {
		rs, e := tx.Query(ctx, `SELECT transaction_hash,transaction_index,status,CASE WHEN octet_length(payload::text)<=33554432 THEN payload ELSE NULL END FROM tickergarden.chain_receipts WHERE chain_id=$1 AND block_hash=$2 ORDER BY transaction_index LIMIT 16385`, s.ChainID, b.hash)
		if e != nil {
			return fail()
		}
		receipts := []chainrpc.Receipt{}
		found := 0
		for rs.Next() {
			var th, status string
			var index uint64
			var raw []byte
			var r chainrpc.Receipt
			if rs.Scan(&th, &index, &status, &raw) != nil {
				rs.Close()
				return fail()
			}
			total += len(raw)
			if total > 64<<20 || index != uint64(len(receipts)) || json.Unmarshal(raw, &r) != nil || chainrpc.ValidateTransactionReceipt(th, &r) != nil || r.Status != status || !strings.EqualFold(r.BlockHash, b.hash) || !strings.EqualFold(r.TransactionHash, th) {
				rs.Close()
				return fail()
			}
			height, e := chainrpc.Quantity(r.BlockNumber)
			ri, ie := chainrpc.Quantity(r.TransactionIndex)
			if e != nil || ie != nil || height != b.number || ri != index {
				rs.Close()
				return fail()
			}
			receipts = append(receipts, r)
			if strings.EqualFold(th, hash) {
				found++
				o.Receipts = append(o.Receipts, ObservedReceipt{r, b.canonical})
			}
		}
		e = rs.Err()
		rs.Close()
		digest, de := chainrpc.ReceiptSetCommitment(receipts)
		if e != nil || de != nil || digest != b.digest || len(receipts) != b.count || found != 1 {
			return fail()
		}
	}
	status, err := DeriveStatus(o)
	if err != nil {
		return fail()
	}
	if tx.Commit(ctx) != nil {
		return fail()
	}
	return JournalStatus{status, "indexed_journal", strconv.FormatUint(start, 10), observed.UTC(), "not_performed"}, nil
}
