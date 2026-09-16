package useractivity

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"regexp"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

var ErrCursor = errors.New("invalid activity cursor")
var ErrRevision = errors.New("activity history changed; restart pagination")
var accountPattern = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var digestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

type Store struct {
	Pool         *pgxpool.Pool
	ChainID      uint64
	GenesisHash  string
	ManifestHash string
	StartBlock   uint64
}
type Page struct {
	ChainID           uint64    `json:"chainId"`
	Account           string    `json:"account"`
	Items             []Record  `json:"items"`
	NextCursor        *string   `json:"nextCursor"`
	IndexedFrom       string    `json:"indexedFrom"`
	SourceBlockNumber string    `json:"sourceBlockNumber"`
	SourceBlockHash   string    `json:"sourceBlockHash"`
	Revision          string    `json:"revision"`
	Finality          string    `json:"finality"`
	ObservedAt        time.Time `json:"observedAt"`
	DisplayOnly       bool      `json:"displayOnly"`
}
type pageCursor struct {
	Version  int    `json:"v"`
	Revision string `json:"revision"`
	Account  string `json:"account"`
	After    string `json:"after"`
}
type historyBlock struct {
	number        uint64
	hash          string
	receiptCount  int
	receiptDigest string
	recordCount   int
	recordDigest  string
	receipts      []chainrpc.Receipt
	logs          map[string]chainrpc.Log
	lastLogIndex  uint64
	hasLogs       bool
	records       []Record
}

// Load validates every batch before filtering by address. A missing batch,
// including an empty block, must not become empty history. Digests establish
// local storage integrity, not independent chain proofs or verified signers.
func (s *Store) Load(ctx context.Context, account string, limit int, cursor string) (Page, error) {
	fail := func() (Page, error) { return Page{}, ErrEvidence }
	if s == nil || s.Pool == nil || (s.ChainID != 4663 && s.ChainID != 46630 && s.ChainID != 421614) || !canonicalHash.MatchString(s.GenesisHash) || !canonicalHash.MatchString(s.ManifestHash) || !accountPattern.MatchString(account) || account == "0x0000000000000000000000000000000000000000" || limit < 1 || limit > 100 {
		return fail()
	}
	var after pageCursor
	if cursor != "" {
		if len(cursor) > 1024 {
			return Page{}, ErrCursor
		}
		raw, e := base64.RawURLEncoding.DecodeString(cursor)
		if e != nil {
			return Page{}, ErrCursor
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&after) != nil || decoder.Decode(new(any)) != io.EOF || after.Version != 1 || after.Account != account || len(after.After) > 256 || after.After == "" || !digestPattern.MatchString(after.Revision) {
			return Page{}, ErrCursor
		}
		canonical, _ := json.Marshal(after)
		if !bytes.Equal(raw, canonical) {
			return Page{}, ErrCursor
		}
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	var journalStart, tip, final uint64
	var finalHash string
	var observed time.Time
	err = tx.QueryRow(ctx, `SELECT start_block,tip_number,finalized_number,finalized_hash,updated_at FROM tickergarden.chain_journal WHERE chain_id=$1 AND genesis_hash=$2 AND updated_at>=now()-interval '120 seconds' AND updated_at<=now()+interval '5 seconds'`, s.ChainID, s.GenesisHash).Scan(&journalStart, &tip, &final, &finalHash, &observed)
	if err != nil || journalStart > s.StartBlock || s.StartBlock > final || final > tip || final-s.StartBlock >= 1000000 || !canonicalHash.MatchString(finalHash) {
		return fail()
	}
	rows, err := tx.Query(ctx, `SELECT b.number,b.hash,b.parent_hash,b.receipt_count,b.receipt_set_hash,a.record_count,a.records_hash FROM tickergarden.chain_blocks b JOIN tickergarden.user_activity_blocks a ON a.chain_id=b.chain_id AND a.block_hash=b.hash WHERE b.chain_id=$1 AND b.canonical AND b.events_verified AND b.number BETWEEN $2 AND $3 AND a.manifest_hash=$4 AND a.extractor_version=$5 AND a.receipt_set_hash=b.receipt_set_hash ORDER BY b.number`, s.ChainID, s.StartBlock, final, s.ManifestHash, Version)
	if err != nil {
		return fail()
	}
	blocks := []*historyBlock{}
	byHash := map[string]*historyBlock{}
	next := s.StartBlock
	prior := ""
	for rows.Next() {
		b := &historyBlock{receipts: []chainrpc.Receipt{}, records: []Record{}, logs: map[string]chainrpc.Log{}}
		var parent string
		if rows.Scan(&b.number, &b.hash, &parent, &b.receiptCount, &b.receiptDigest, &b.recordCount, &b.recordDigest) != nil || b.number != next || !canonicalHash.MatchString(b.hash) || !canonicalHash.MatchString(parent) || (next > s.StartBlock && parent != prior) || b.receiptCount < 0 || b.receiptCount > 16384 || b.recordCount < 0 || b.recordCount > 100000 {
			rows.Close()
			return fail()
		}
		if next == 0 && b.hash != s.GenesisHash {
			rows.Close()
			return fail()
		}
		if next == 1 && parent != s.GenesisHash {
			rows.Close()
			return fail()
		}
		blocks = append(blocks, b)
		byHash[b.hash] = b
		next++
		prior = b.hash
	}
	err = rows.Err()
	rows.Close()
	if err != nil || next != final+1 || prior != finalHash {
		return fail()
	}
	rows, err = tx.Query(ctx, `SELECT r.block_hash,r.transaction_hash,r.transaction_index,r.status,CASE WHEN octet_length(r.payload::text)<=33554432 THEN r.payload ELSE NULL END FROM tickergarden.chain_receipts r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=$1 AND b.canonical AND b.number BETWEEN $2 AND $3 ORDER BY b.number,r.transaction_index LIMIT 100001`, s.ChainID, s.StartBlock, final)
	if err != nil {
		return fail()
	}
	budget, receiptTotal, logTotal := 0, 0, 0
	for rows.Next() {
		var bh, th, status string
		var ti uint64
		var raw []byte
		var r chainrpc.Receipt
		if rows.Scan(&bh, &th, &ti, &status, &raw) != nil {
			rows.Close()
			return fail()
		}
		b := byHash[bh]
		budget += len(raw)
		receiptTotal++
		if b == nil || receiptTotal > 100000 || budget > 64<<20 || json.Unmarshal(raw, &r) != nil || ti != uint64(len(b.receipts)) || r.TransactionIndex != fmt.Sprintf("0x%x", ti) || r.BlockHash != bh || r.BlockNumber != fmt.Sprintf("0x%x", b.number) || r.TransactionHash != th || r.Status != status || chainrpc.ValidateTransactionReceipt(th, &r) != nil {
			rows.Close()
			return fail()
		}
		b.receipts = append(b.receipts, r)
		for _, log := range r.Logs {
			logTotal++
			if logTotal > 100000 {
				rows.Close()
				return fail()
			}
			li, _ := chainrpc.Quantity(log.LogIndex)
			if b.hasLogs && li <= b.lastLogIndex {
				rows.Close()
				return fail()
			}
			b.hasLogs = true
			b.lastLogIndex = li
			key := strconv.FormatUint(li, 10)
			if _, exists := b.logs[key]; exists {
				rows.Close()
				return fail()
			}
			b.logs[key] = log
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return fail()
	}
	for _, b := range blocks {
		if ctx.Err() != nil {
			return fail()
		}
		digest, e := chainrpc.ReceiptSetCommitment(b.receipts)
		if e != nil || len(b.receipts) != b.receiptCount || digest != b.receiptDigest {
			return fail()
		}
	}
	rows, err = tx.Query(ctx, `SELECT r.block_hash,r.account,r.block_number,r.transaction_index,r.log_index,CASE WHEN octet_length(r.payload::text)<=1048576 THEN r.payload ELSE NULL END FROM tickergarden.user_activity_records r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=$1 AND b.canonical AND b.number BETWEEN $2 AND $3 ORDER BY b.number,r.transaction_index,r.log_index,r.account LIMIT 100001`, s.ChainID, s.StartBlock, final)
	if err != nil {
		return fail()
	}
	recordTotal := 0
	for rows.Next() {
		var bh, owner string
		var n, ti, li uint64
		var raw []byte
		var r Record
		if rows.Scan(&bh, &owner, &n, &ti, &li, &raw) != nil {
			rows.Close()
			return fail()
		}
		b := byHash[bh]
		budget += len(raw)
		recordTotal++
		if b == nil || recordTotal > 100000 || budget > 64<<20 || decodeRecord(raw, &r) != nil || r.ChainID != s.ChainID || r.Account != owner || r.BlockHash != bh || n != b.number || r.BlockNumber != strconv.FormatUint(n, 10) || r.TransactionIndex != strconv.FormatUint(ti, 10) || r.LogIndex != strconv.FormatUint(li, 10) {
			rows.Close()
			return fail()
		}
		log, ok := b.logs[r.LogIndex]
		if !ok {
			rows.Close()
			return fail()
		}
		decoded, e := events.Decode(r.Module, log)
		if e != nil {
			rows.Close()
			return fail()
		}
		expected, e := recordsFromDecoded(s.ChainID, log, decoded)
		if e != nil {
			rows.Close()
			return fail()
		}
		match := false
		for _, want := range expected {
			if reflect.DeepEqual(want, r) {
				match = true
				break
			}
		}
		if !match {
			rows.Close()
			return fail()
		}
		b.records = append(b.records, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return fail()
	}
	revision := sha256.New()
	fmt.Fprintf(revision, "%d:%s:%s:%s:%d\n", s.ChainID, s.GenesisHash, s.ManifestHash, Version, s.StartBlock)
	items := []Record{}
	for _, b := range blocks {
		if ctx.Err() != nil {
			return fail()
		}
		if len(b.records) != b.recordCount {
			return fail()
		}
		digest := sha256.New()
		digest.Write([]byte("tickergarden-user-activity-v1\n"))
		for _, r := range b.records {
			raw, e := json.Marshal(r)
			if e != nil {
				return fail()
			}
			digest.Write(raw)
			digest.Write([]byte{'\n'})
			if r.Account == account {
				items = append(items, r)
			}
		}
		actual := "sha256:" + hex.EncodeToString(digest.Sum(nil))
		if actual != b.recordDigest {
			return fail()
		}
		fmt.Fprintf(revision, "%d:%s:%s:%s\n", b.number, b.hash, b.receiptDigest, actual)
	}
	rev := "sha256:" + hex.EncodeToString(revision.Sum(nil))
	if cursor != "" && after.Revision != rev {
		return Page{}, ErrRevision
	}
	// Ascending order reconstructs commitments; user history is newest first.
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}
	start := 0
	if cursor != "" {
		found := false
		for i, r := range items {
			if r.ID == after.After {
				start = i + 1
				found = true
				break
			}
		}
		if !found {
			return Page{}, ErrCursor
		}
	}
	end := start + limit
	if end > len(items) {
		end = len(items)
	}
	page := Page{ChainID: s.ChainID, Account: account, Items: append([]Record{}, items[start:end]...), IndexedFrom: strconv.FormatUint(s.StartBlock, 10), SourceBlockNumber: strconv.FormatUint(final, 10), SourceBlockHash: finalHash, Revision: rev, Finality: "finalized", ObservedAt: observed, DisplayOnly: true}
	if end < len(items) {
		data, _ := json.Marshal(pageCursor{Version: 1, Revision: rev, Account: account, After: items[end-1].ID})
		c := base64.RawURLEncoding.EncodeToString(data)
		page.NextCursor = &c
	}
	if tx.Commit(ctx) != nil {
		return fail()
	}
	return page, nil
}

func decodeRecord(raw []byte, r *Record) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(r); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return ErrEvidence
	}
	return nil
}
