package chainrpc

import (
	"context"
	"encoding/json"
	"errors"
)

type EventExclusionProof struct {
	Header   json.RawMessage `json:"header"`
	Emitters []string        `json:"emitters"`
}

// ScopedObserver uses negative header blooms as event-absence proofs, otherwise
// verifies a single complete receipt bundle. Emitters must be authenticated by
// the caller; candidate publication independently rechecks the final inventory.
type ScopedObserver struct {
	*Client
	cache    *scopedHeaderCache
	Emitters func(context.Context, Header) ([]string, error)
}

func (c ScopedObserver) Observe(ctx context.Context, h Header) (Observation, error) {
	if c.Emitters == nil {
		return Observation{}, errors.New("event scope missing")
	}
	if c.cache == nil {
		canonical, e := c.Client.Header(ctx, h.Number)
		if e != nil || canonical.Hash != h.Hash {
			return Observation{}, errors.New("scoped observation canonical mismatch")
		}
	}
	emitters, err := c.Emitters(ctx, h)
	if err != nil {
		return Observation{}, err
	}
	var raw json.RawMessage
	if c.cache != nil {
		raw = c.cache.byHash[h.Hash]
	}
	if len(raw) == 0 {
		err = c.call(ctx, "eth_getBlockByHash", []any{h.Hash, false}, &raw)
	}
	if err != nil {
		return Observation{}, err
	}
	if VerifyEventExclusion(raw, h.Hash, emitters) == nil {
		return Observation{Logs: []Log{}, Receipts: []Receipt{}, Exclusion: &EventExclusionProof{Header: raw, Emitters: emitters}}, nil
	}
	var receipts []json.RawMessage
	if err = c.call(ctx, "eth_getBlockReceipts", []any{h.Hash}, &receipts); err != nil {
		return Observation{}, err
	}
	proof, err := VerifyReceiptRootBundle(raw, receipts, h.Hash)
	if err != nil {
		return Observation{}, err
	}
	observation := Observation{Logs: []Log{}, Receipts: []Receipt{}, RootProof: &proof}
	for _, r := range receipts {
		var receipt Receipt
		if json.Unmarshal(r, &receipt) != nil {
			return Observation{}, errors.New("invalid verified receipt")
		}
		observation.Receipts = append(observation.Receipts, receipt)
		observation.Logs = append(observation.Logs, receipt.Logs...)
	}
	return observation, nil
}
