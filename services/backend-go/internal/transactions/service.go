package transactions

import (
	"context"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"time"
)

type JournalReader interface {
	Load(context.Context, string) (JournalStatus, error)
}
type RPC interface {
	ChainID(context.Context) (uint64, error)
	Header(context.Context, string) (chainrpc.Header, error)
	TransactionByHash(context.Context, string) (*chainrpc.TransactionLookup, error)
	TransactionReceipt(context.Context, string) (*chainrpc.Receipt, error)
}
type Service struct {
	Journal     JournalReader
	RPC         RPC
	ChainID     uint64
	GenesisHash string
}
type CombinedStatus struct {
	Status
	Source            string    `json:"source"`
	IndexedFrom       string    `json:"indexedFrom"`
	JournalHeadNumber string    `json:"journalHeadNumber"`
	JournalHeadHash   string    `json:"journalHeadHash"`
	JournalObservedAt time.Time `json:"journalObservedAt"`
	RPCObservedAt     time.Time `json:"rpcObservedAt"`
}

// Load brackets live observations with a stable RPC head and unchanged journal.
// A contradiction is unavailable, never a fabricated pending/confirmed result.
func (s *Service) Load(ctx context.Context, hash string) (CombinedStatus, error) {
	fail := func() (CombinedStatus, error) { return CombinedStatus{}, ErrObservation }
	if s.Journal == nil || s.RPC == nil || !hashPattern.MatchString(hash) || !hashPattern.MatchString(s.GenesisHash) {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	indexed, err := s.Journal.Load(ctx, hash)
	if err != nil || indexed.ChainID != s.ChainID || indexed.TransactionHash != hash {
		return fail()
	}
	chain, err := s.RPC.ChainID(ctx)
	if err != nil || chain != s.ChainID {
		return fail()
	}
	block := func(tag string) (Block, error) {
		h, e := s.RPC.Header(ctx, tag)
		if e != nil {
			return Block{}, e
		}
		n, e := h.Height()
		if e != nil || !hashPattern.MatchString(strings.ToLower(h.Hash)) {
			return Block{}, ErrObservation
		}
		return Block{n, strings.ToLower(h.Hash)}, nil
	}
	genesis, err := block("0x0")
	if err != nil || genesis.Number != 0 || genesis.Hash != s.GenesisHash {
		return fail()
	}
	head, err := block("latest")
	if err != nil {
		return fail()
	}
	finalized, err := block("finalized")
	if err != nil {
		return fail()
	}
	canonicalFinal, err := block(fmt.Sprintf("0x%x", finalized.Number))
	if err != nil || canonicalFinal != finalized {
		return fail()
	}
	indexHeight, err := strconv.ParseUint(indexed.HeadNumber, 10, 63)
	if err != nil || head.Number < indexHeight {
		return fail()
	}
	indexFinal, err := strconv.ParseUint(indexed.FinalizedNumber, 10, 63)
	if err != nil || finalized.Number < indexFinal {
		return fail()
	}
	canonicalIndex, err := block(fmt.Sprintf("0x%x", indexHeight))
	if err != nil || canonicalIndex.Number != indexHeight || canonicalIndex.Hash != indexed.HeadHash {
		return fail()
	}
	lookup, err := s.RPC.TransactionByHash(ctx, hash)
	if err != nil {
		return fail()
	}
	receipt, err := s.RPC.TransactionReceipt(ctx, hash)
	if err != nil {
		return fail()
	}
	observation := Observation{ChainID: s.ChainID, TransactionHash: hash, Head: head, Finalized: finalized, Receipts: []ObservedReceipt{}}
	if lookup == nil {
		if receipt != nil || indexed.Receipt != nil {
			return fail()
		}
	} else {
		if !strings.EqualFold(lookup.Hash, hash) {
			return fail()
		}
		if lookup.Pending() {
			if lookup.BlockNumber != nil || lookup.TransactionIndex != nil || receipt != nil || indexed.Receipt != nil {
				return fail()
			}
			observation.PendingObserved = true
		} else {
			if receipt == nil || chainrpc.ValidateTransactionReceipt(hash, receipt) != nil || lookup.BlockNumber == nil || lookup.TransactionIndex == nil || !strings.EqualFold(*lookup.BlockHash, receipt.BlockHash) || *lookup.BlockNumber != receipt.BlockNumber || *lookup.TransactionIndex != receipt.TransactionIndex {
				return fail()
			}
			height, e := chainrpc.Quantity(receipt.BlockNumber)
			if e != nil {
				return fail()
			}
			canonical, e := block(receipt.BlockNumber)
			if e != nil || canonical.Number != height || !strings.EqualFold(canonical.Hash, receipt.BlockHash) {
				return fail()
			}
			for _, orphan := range indexed.OrphanedReceipts {
				if strings.EqualFold(orphan.BlockHash, receipt.BlockHash) {
					return fail()
				}
			}
			observation.Receipts = append(observation.Receipts, ObservedReceipt{*receipt, true})
		}
	}
	status, err := DeriveStatus(observation)
	if err != nil {
		return fail()
	}
	if indexed.Receipt != nil && !reflect.DeepEqual(indexed.Receipt, status.Receipt) {
		return fail()
	}
	status.OrphanedReceipts = append([]ReceiptStatus{}, indexed.OrphanedReceipts...)
	if status.Receipt == nil && !observation.PendingObserved && len(status.OrphanedReceipts) > 0 {
		status.State = "reorged"
	}
	end, err := block("latest")
	if err != nil || end != head {
		return fail()
	}
	after, err := s.Journal.Load(ctx, hash)
	if err != nil || !reflect.DeepEqual(after.Status, indexed.Status) || after.IndexedFrom != indexed.IndexedFrom || ctx.Err() != nil {
		return fail()
	}
	return CombinedStatus{status, "indexed_journal_and_rpc", indexed.IndexedFrom, indexed.HeadNumber, indexed.HeadHash, indexed.ObservedAt, time.Now().UTC()}, nil
}
