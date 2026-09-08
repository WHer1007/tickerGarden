package chainrpc

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ProjectLogs is a bounded, address/topic-filtered node query. It is not a
// receipt-root proof and must not promote display history to settlement evidence.
func (c *Client) ProjectLogs(ctx context.Context, addresses, topics []string, from, to uint64) ([]Log, error) {
	bad := errors.New("invalid project log response or scope")
	if from > to || to-from >= 2048 || len(addresses) == 0 || len(addresses) > 64 || len(topics) == 0 || len(topics) > 256 {
		return nil, bad
	}
	allowed := map[string]bool{}
	known := map[string]bool{}
	for _, a := range addresses {
		if !addressPattern.MatchString(a) {
			return nil, bad
		}
		allowed[strings.ToLower(a)] = true
	}
	for _, t := range topics {
		if !hashPattern.MatchString(t) {
			return nil, bad
		}
		known[strings.ToLower(t)] = true
	}
	var logs []Log
	filter := map[string]any{"address": addresses, "topics": []any{topics}, "fromBlock": fmt.Sprintf("0x%x", from), "toBlock": fmt.Sprintf("0x%x", to)}
	if err := c.call(ctx, "eth_getLogs", []any{filter}, &logs); err != nil {
		return nil, err
	}
	if logs == nil || len(logs) > 10000 {
		return nil, bad
	}
	seen := map[string]bool{}
	blocks := map[uint64]string{}
	for i := range logs {
		l := &logs[i]
		n, e := Quantity(l.BlockNumber)
		_, te := Quantity(l.TransactionIndex)
		_, le := Quantity(l.LogIndex)
		if e != nil || te != nil || le != nil || n < from || n > to || l.Removed || !allowed[strings.ToLower(l.Address)] || !hashPattern.MatchString(l.BlockHash) || !hashPattern.MatchString(l.TransactionHash) || !dataPattern.MatchString(l.Data) || len(l.Topics) == 0 || len(l.Topics) > 4 || !known[strings.ToLower(l.Topics[0])] {
			return nil, bad
		}
		for _, t := range l.Topics {
			if !hashPattern.MatchString(t) {
				return nil, bad
			}
		}
		key := l.BlockNumber + ":" + l.LogIndex
		if seen[key] || (blocks[n] != "" && blocks[n] != l.BlockHash) {
			return nil, bad
		}
		seen[key] = true
		blocks[n] = l.BlockHash
		l.Address = strings.ToLower(l.Address)
	}
	sort.Slice(logs, func(i, j int) bool {
		a, _ := Quantity(logs[i].BlockNumber)
		b, _ := Quantity(logs[j].BlockNumber)
		if a != b {
			return a < b
		}
		a, _ = Quantity(logs[i].TransactionIndex)
		b, _ = Quantity(logs[j].TransactionIndex)
		if a != b {
			return a < b
		}
		a, _ = Quantity(logs[i].LogIndex)
		b, _ = Quantity(logs[j].LogIndex)
		return a < b
	})
	return logs, nil
}
