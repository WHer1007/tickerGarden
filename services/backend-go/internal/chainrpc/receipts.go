package chainrpc

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"

	"golang.org/x/sync/errgroup"
)

type Receipt struct {
	TransactionHash  string `json:"transactionHash"`
	TransactionIndex string `json:"transactionIndex"`
	BlockHash        string `json:"blockHash"`
	BlockNumber      string `json:"blockNumber"`
	Status           string `json:"status"`
	Logs             []Log  `json:"logs"`
}

// Logs cross-checks the hash-scoped filter with every transaction receipt in the
// block. Missing receipts, provider truncation and mixed branches fail closed.
// This is consistency checking of one RPC source, not receipt-root verification.
type Observation struct {
	Logs      []Log
	Receipts  []Receipt
	RootProof *ReceiptRootVerification
	Exclusion *EventExclusionProof
}

func (c *Client) Logs(ctx context.Context, h Header) ([]Log, error) {
	observation, e := c.Observe(ctx, h)
	return observation.Logs, e
}
func (c *Client) Observe(ctx context.Context, h Header) (Observation, error) {
	if _, e := h.Time(); e != nil {
		return Observation{}, errors.New("invalid observation timestamp")
	}
	var block struct {
		Header
		Transactions []string `json:"transactions"`
	}
	if e := c.call(ctx, "eth_getBlockByHash", []any{h.Hash, false}, &block); e != nil {
		return Observation{}, e
	}
	if block.Hash != h.Hash || block.Number != h.Number || block.ParentHash != h.ParentHash || block.Timestamp != h.Timestamp || block.Transactions == nil {
		return Observation{}, errors.New("receipt block does not match observed header")
	}
	// Bound scheduling and intermediate allocations, rather than silently sampling
	// dense blocks. Exceeding the limit leaves the checkpoint unchanged.
	if len(block.Transactions) > 16384 {
		return Observation{}, errors.New("block exceeds receipt transaction bound")
	}
	seen := map[string]bool{}
	for _, tx := range block.Transactions {
		k := strings.ToLower(tx)
		if !hashPattern.MatchString(tx) || seen[k] {
			return Observation{}, errors.New("invalid or duplicate transaction in block")
		}
		seen[k] = true
	}
	receipts := make([]Receipt, len(block.Transactions))
	group, child := errgroup.WithContext(ctx)
	group.SetLimit(8)
	var mu sync.Mutex
	total := 0
	for index, hash := range block.Transactions {
		if child.Err() != nil {
			break
		}
		group.Go(func() error {
			var r Receipt
			if e := c.call(child, "eth_getTransactionReceipt", []any{hash}, &r); e != nil {
				return e
			}
			txIndex, e := Quantity(r.TransactionIndex)
			if e != nil || txIndex != uint64(index) || !strings.EqualFold(r.TransactionHash, hash) || r.BlockHash != h.Hash || r.BlockNumber != h.Number || r.Logs == nil || (r.Status != "0x0" && r.Status != "0x1") || (r.Status == "0x0" && len(r.Logs) != 0) {
				return errors.New("receipt identity, status or logs mismatch")
			}
			encoded, e := json.Marshal(r.Logs)
			if e != nil {
				return errors.New("cannot size receipt logs")
			}
			mu.Lock()
			total += len(encoded)
			tooLarge := total > 16<<20
			mu.Unlock()
			if tooLarge {
				return errors.New("block receipt logs exceed 16 MiB")
			}
			receipts[index] = r
			return nil
		})
	}
	if e := group.Wait(); e != nil {
		return Observation{}, e
	}
	if e := ctx.Err(); e != nil {
		return Observation{}, e
	}
	filter, e := c.filterLogs(ctx, h)
	if e != nil {
		return Observation{}, e
	}
	byIndex := map[uint64]Log{}
	for _, l := range filter {
		idx, _ := Quantity(l.LogIndex)
		byIndex[idx] = l
	}
	result := make([]Log, 0, len(filter))
	for index, r := range receipts {
		for _, l := range r.Logs {
			idx, e := Quantity(l.LogIndex)
			txIndex, te := Quantity(l.TransactionIndex)
			if e != nil || te != nil || idx != uint64(len(result)) || txIndex != uint64(index) || !strings.EqualFold(l.TransactionHash, r.TransactionHash) || l.BlockHash != h.Hash || l.BlockNumber != h.Number || l.Removed {
				return Observation{}, errors.New("receipt log order or provenance mismatch")
			}
			matched, ok := byIndex[idx]
			if !ok || !reflect.DeepEqual(l, matched) {
				return Observation{}, errors.New("receipt and filter logs differ")
			}
			result = append(result, l)
		}
	}
	if len(result) != len(filter) {
		return Observation{}, errors.New("filter includes logs absent from receipts")
	}
	return Observation{Logs: result, Receipts: receipts}, nil
}
