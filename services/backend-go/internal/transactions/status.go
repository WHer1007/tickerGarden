// Package transactions derives read-only status from authenticated chain observations.
package transactions

import (
	"errors"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"tickergarden/backend/internal/chainrpc"
)

var ErrObservation = errors.New("transaction observations are incomplete or inconsistent")
var hashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

type Block struct {
	Number uint64
	Hash   string
}
type ObservedReceipt struct {
	Receipt   chainrpc.Receipt
	Canonical bool
}

// Observation is not self-authenticating. The reader must bind chain/genesis,
// freshness, canonical ancestry and complete receipt history before deriving it.
// PendingObserved requires a matching live transaction lookup without a block;
// absence of a receipt alone is never proof that a transaction is pending.
type Observation struct {
	ChainID         uint64
	TransactionHash string
	Head            Block
	Finalized       Block
	PendingObserved bool
	Receipts        []ObservedReceipt
}
type ReceiptStatus struct {
	BlockNumber      string `json:"blockNumber"`
	BlockHash        string `json:"blockHash"`
	TransactionIndex string `json:"transactionIndex"`
	Execution        string `json:"execution"`
}
type Status struct {
	ChainID          uint64          `json:"chainId"`
	TransactionHash  string          `json:"transactionHash"`
	State            string          `json:"state"`
	Confirmations    string          `json:"confirmations"`
	Receipt          *ReceiptStatus  `json:"receipt"`
	OrphanedReceipts []ReceiptStatus `json:"orphanedReceipts"`
	HeadNumber       string          `json:"headNumber"`
	HeadHash         string          `json:"headHash"`
	FinalizedNumber  string          `json:"finalizedNumber"`
	FinalizedHash    string          `json:"finalizedHash"`
}

func DeriveStatus(o Observation) (Status, error) {
	fail := func() (Status, error) { return Status{}, ErrObservation }
	if (o.ChainID != 4663 && o.ChainID != 46630 && o.ChainID != 421614) || !hashPattern.MatchString(o.TransactionHash) || !hashPattern.MatchString(o.Head.Hash) || !hashPattern.MatchString(o.Finalized.Hash) || o.Head.Number > math.MaxInt64 || o.Finalized.Number > o.Head.Number || (o.Head.Number == o.Finalized.Number && o.Head.Hash != o.Finalized.Hash) || o.Receipts == nil || len(o.Receipts) > 128 {
		return fail()
	}
	out := Status{ChainID: o.ChainID, TransactionHash: o.TransactionHash, State: "unknown", Confirmations: "0", OrphanedReceipts: []ReceiptStatus{}, HeadNumber: strconv.FormatUint(o.Head.Number, 10), HeadHash: o.Head.Hash, FinalizedNumber: strconv.FormatUint(o.Finalized.Number, 10), FinalizedHash: o.Finalized.Hash}
	seen := map[string]bool{}
	for _, observed := range o.Receipts {
		r := observed.Receipt
		if len(r.Logs) > 16384 || chainrpc.ValidateTransactionReceipt(o.TransactionHash, &r) != nil {
			return fail()
		}
		height, _ := chainrpc.Quantity(r.BlockNumber)
		index, _ := chainrpc.Quantity(r.TransactionIndex)
		hash := strings.ToLower(r.BlockHash)
		if height > math.MaxInt64 || seen[hash] {
			return fail()
		}
		seen[hash] = true
		execution := "succeeded"
		if r.Status == "0x0" {
			execution = "reverted"
		}
		receipt := ReceiptStatus{strconv.FormatUint(height, 10), hash, strconv.FormatUint(index, 10), execution}
		if !observed.Canonical {
			// A block with the very same hash as a pinned canonical boundary cannot
			// simultaneously be recorded as orphaned.
			if hash == o.Head.Hash || hash == o.Finalized.Hash {
				return fail()
			}
			out.OrphanedReceipts = append(out.OrphanedReceipts, receipt)
			continue
		}
		if out.Receipt != nil || o.PendingObserved || height > o.Head.Number || (height == o.Head.Number && hash != o.Head.Hash) || (height == o.Finalized.Number && hash != o.Finalized.Hash) || (hash == o.Head.Hash && height != o.Head.Number) || (hash == o.Finalized.Hash && height != o.Finalized.Number) {
			return fail()
		}
		out.Receipt = &receipt
		out.State = "confirmed"
		out.Confirmations = strconv.FormatUint(o.Head.Number-height+1, 10)
		if height <= o.Finalized.Number {
			out.State = "finalized"
		}
	}
	if out.Receipt == nil {
		if o.PendingObserved {
			out.State = "pending"
		} else if len(out.OrphanedReceipts) > 0 {
			out.State = "reorged"
		}
	}
	sort.Slice(out.OrphanedReceipts, func(i, j int) bool {
		a, b := out.OrphanedReceipts[i], out.OrphanedReceipts[j]
		an, _ := strconv.ParseUint(a.BlockNumber, 10, 64)
		bn, _ := strconv.ParseUint(b.BlockNumber, 10, 64)
		if an != bn {
			return an < bn
		}
		return a.BlockHash < b.BlockHash
	})
	return out, nil
}
