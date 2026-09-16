package chainrpc

import (
	"context"
	"encoding/json"
	"errors"
	"golang.org/x/sync/errgroup"
	"sync"
)

// Fetch at most eight receipts concurrently, retaining transaction order. The
// aggregate budget is checked before retaining each response, never by sampling.
func (c *Client) receiptRootInputs(ctx context.Context, hashes []string) ([]json.RawMessage, error) {
	if len(hashes) > 16384 {
		return nil, errors.New("receipt transaction bound exceeded")
	}
	result := make([]json.RawMessage, len(hashes))
	group, child := errgroup.WithContext(ctx)
	group.SetLimit(8)
	var mu sync.Mutex
	size := 0
	for i, hash := range hashes {
		if child.Err() != nil {
			break
		}
		group.Go(func() error {
			if err := child.Err(); err != nil {
				return err
			}
			var raw json.RawMessage
			if err := c.call(child, "eth_getTransactionReceipt", []any{hash}, &raw); err != nil {
				return err
			}
			mu.Lock()
			defer mu.Unlock()
			if len(raw) > (64<<20)-size {
				return errors.New("receipt root payload budget exceeded")
			}
			size += len(raw)
			result[i] = raw
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
