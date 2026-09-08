package observationwork

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"tickergarden/backend/internal/deployment"
)

func Execute(ctx context.Context, rpc deployment.BindingObserver, r Request) (deployment.ObservationBatch, error) {
	if _, _, e := r.Encode(); e != nil {
		return deployment.ObservationBatch{}, e
	}
	s := deployment.NewReadSession(rpc, r.Block.Hash)
	var b deployment.ObservationBatch
	var e error
	if r.Kind == "fees" {
		b, e = deployment.ObserveFeeBlock(ctx, s, r.Manifest, r.Block, r.Markets)
	} else {
		b, e = deployment.ObserveHolderBlock(ctx, s, r.Manifest, r.Block, r.Markets, r.Historical...)
	}
	if e != nil {
		return b, e
	}
	chain, e := rpc.ChainID(ctx)
	if e != nil || chain != r.Manifest.ChainID {
		return b, errors.New("observation chain changed")
	}
	h, e := rpc.Header(ctx, r.Block.Number)
	if e != nil || !strings.EqualFold(h.Hash, r.Block.Hash) || h.Timestamp != r.Block.Timestamp {
		return b, errors.New("observation source changed")
	}
	return b, Validate(r, b)
}
func Validate(r Request, b deployment.ObservationBatch) error {
	if r.Version != Version || (r.Kind != "fees" && r.Kind != "holders") {
		return errors.New("invalid observation phase")
	}
	scope := deployment.FeeObservationScope
	if r.Kind == "holders" {
		scope = deployment.HolderObservationScope
	}
	if b.ChainID != r.Manifest.ChainID || b.BlockHash != r.Block.Hash || b.BlockNumber != r.Block.Number || b.Scope != scope || b.Expected != len(b.Observations) {
		return errors.New("observation result scope mismatch")
	}
	return nil
}

// Merge keeps shared-asset boundaries intact and rejects conflicting duplicate
// evidence. Financial checks are retained verbatim, including false/missing flags.
func Merge(requests []Request, batches []deployment.ObservationBatch) (deployment.ObservationBatch, deployment.ObservationBatch, error) {
	fee := deployment.ObservationBatch{}
	holder := deployment.ObservationBatch{}
	if len(requests) != len(batches) || len(requests) == 0 {
		return fee, holder, errors.New("incomplete observation work")
	}
	seen := map[string]deployment.StateObservation{}
	for i, r := range requests {
		b := batches[i]
		originalManifest, _ := json.Marshal(requests[0].Manifest)
		currentManifest, _ := json.Marshal(r.Manifest)
		if !bytes.Equal(originalManifest, currentManifest) {
			return fee, holder, errors.New("mixed observation manifest")
		}
		if r.Manifest.ChainID != requests[0].Manifest.ChainID || r.Block != requests[0].Block {
			return fee, holder, errors.New("mixed observation anchor")
		}
		if e := Validate(r, b); e != nil {
			return fee, holder, e
		}
		target := &fee
		if r.Kind == "holders" {
			target = &holder
		}
		if target.Scope == "" {
			*target = b
			target.Observations = nil
		} else if target.BlockHash != b.BlockHash || target.ChainID != b.ChainID {
			return fee, holder, errors.New("mixed observation anchor")
		}
		for _, o := range b.Observations {
			key := fmt.Sprintf("%s:%s:%s", r.Kind, o.Kind, o.Key)
			if prior, ok := seen[key]; ok {
				left, _ := json.Marshal(prior)
				right, _ := json.Marshal(o)
				if !bytes.Equal(left, right) {
					return fee, holder, errors.New("conflicting scoped observations")
				}
				continue
			}
			seen[key] = o
			target.Observations = append(target.Observations, o)
		}
	}
	if fee.Scope == "" || holder.Scope == "" {
		return fee, holder, errors.New("missing observation phase")
	}
	for _, b := range []*deployment.ObservationBatch{&fee, &holder} {
		sort.Slice(b.Observations, func(i, j int) bool {
			a, c := b.Observations[i], b.Observations[j]
			return a.Kind+":"+a.Key < c.Kind+":"+c.Key
		})
		b.Expected = len(b.Observations)
	}
	return fee, holder, nil
}
func DecodeResult(r Request, raw []byte, digest string) (deployment.ObservationBatch, error) {
	var b deployment.ObservationBatch
	if len(raw) > 16<<20 || Digest(raw) != digest || json.Unmarshal(raw, &b) != nil {
		return b, errors.New("corrupt observation work result")
	}
	return b, Validate(r, b)
}
