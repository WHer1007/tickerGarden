package chainrpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

type scopedHeaderCache struct {
	byNumber  map[uint64]json.RawMessage
	byHash    map[string]json.RawMessage
	moving    map[string]cachedScopeHeader
	finalized uint64
}
type cachedScopeHeader struct {
	header Header
	until  time.Time
}

// NewCachedScopedObserver batches only demanded finalized header ancestry. It
// never prefetches receipts or polls in the background. Moving anchors expire
// after five seconds; publication still authenticates anchors independently.
func NewCachedScopedObserver(c *Client, emitters func(context.Context, Header) ([]string, error)) *ScopedObserver {
	return &ScopedObserver{Client: c, Emitters: emitters, cache: &scopedHeaderCache{byNumber: map[uint64]json.RawMessage{}, byHash: map[string]json.RawMessage{}, moving: map[string]cachedScopeHeader{}}}
}
func (c ScopedObserver) Header(ctx context.Context, tag string) (Header, error) {
	if c.cache == nil {
		return c.Client.Header(ctx, tag)
	}
	cache := c.cache
	if tag == "latest" || tag == "finalized" {
		if v, ok := cache.moving[tag]; ok && time.Now().Before(v.until) {
			return v.header, nil
		}
		h, err := c.Client.Header(ctx, tag)
		if err != nil {
			return h, err
		}
		if tag == "finalized" {
			n, e := h.Height()
			if e != nil || n < cache.finalized {
				return Header{}, errors.New("finality regressed")
			}
			cache.finalized = n
		}
		cache.moving[tag] = cachedScopeHeader{h, time.Now().Add(5 * time.Second)}
		return h, nil
	}
	n, err := Quantity(tag)
	if err != nil {
		return c.Client.Header(ctx, tag)
	}
	if raw, ok := cache.byNumber[n]; ok {
		var h Header
		err = json.Unmarshal(raw, &h)
		return h, err
	}
	end := n
	if n > 0 && n < cache.finalized {
		end = min(n+127, cache.finalized)
	}
	raws := make([]json.RawMessage, end-n+1)
	failures := make([]error, len(raws))
	for base := 0; base < len(raws); base += 16 {
		var group sync.WaitGroup
		for j := base; j < min(base+16, len(raws)); j++ {
			group.Add(1)
			go func(i int) {
				defer group.Done()
				failures[i] = c.call(ctx, "eth_getBlockByNumber", []any{fmt.Sprintf("0x%x", n+uint64(i)), false}, &raws[i])
			}(j)
		}
		group.Wait()
	}
	var first Header
	previous := ""
	for i, raw := range raws {
		if failures[i] != nil {
			return Header{}, failures[i]
		}
		var h Header
		if json.Unmarshal(raw, &h) != nil || h.Number != fmt.Sprintf("0x%x", n+uint64(i)) || (previous != "" && previous != h.ParentHash) {
			return Header{}, errors.New("header batch ancestry mismatch")
		}
		if i == 0 {
			first = h
		}
		previous = h.Hash
	}
	if len(cache.byNumber) > 4096 {
		cache.byNumber = map[uint64]json.RawMessage{}
		cache.byHash = map[string]json.RawMessage{}
	}
	for i, raw := range raws {
		var h Header
		_ = json.Unmarshal(raw, &h)
		height := n + uint64(i)
		if height <= cache.finalized {
			cache.byNumber[height] = raw
			cache.byHash[h.Hash] = raw
		}
	}
	return first, nil
}
