package deployment

import (
	"context"
	"errors"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// VerifyKnownHolderCoverage authenticates current Registry records for the supplied
// inventory and checks the selected Holder accounting mode. Current runtime hashes
// do not prove discovery-time code identity or inventory completeness.
func VerifyKnownHolderCoverage(ctx context.Context, rpc BindingObserver, manifest Manifest, block chainrpc.Header, ids []string) error {
	_, e := ObserveVerifiedKnownHolders(ctx, rpc, manifest, block, ids)
	return e
}

// ObserveVerifiedKnownHolders returns verified current Holder observations plus
// their Registry market records for exact candidate comparison. No partial batch
// is returned on failure; the combined scope is not a persisted worker batch.
func ObserveVerifiedKnownHolders(ctx context.Context, rpc BindingObserver, manifest Manifest, block chainrpc.Header, ids []string, historical ...ServiceAssetTarget) (ObservationBatch, error) {
	bad := errors.New("known Holder coverage verification failed")
	if len(ids) > 1000 {
		return ObservationBatch{}, bad
	}
	if len(ids) == 0 {
		return ObservationBatch{Scope: "known-holder-coverage-v1", ChainID: manifest.ChainID, BlockNumber: block.Number, BlockHash: block.Hash, Observations: []StateObservation{}}, nil
	}
	if _, e := VerifyCoreBindings(ctx, rpc, manifest, block); e != nil {
		return ObservationBatch{}, bad
	}
	registry := ""
	for _, c := range manifest.Contracts {
		if c.Module == "MarketRegistryV1" {
			registry = c.Address
		}
	}
	read := businessReader(ctx, rpc, block)
	markets := map[string]MarketDiscovery{}
	for _, id := range ids {
		if !hex32.MatchString(id) || id == zero32 {
			return ObservationBatch{}, bad
		}
		if _, ok := markets[id]; ok {
			return ObservationBatch{}, bad
		}
		state, e := read(registry, "market(bytes32)", id[2:], marketFields)
		if e != nil || validateMarketState(state) != nil {
			return ObservationBatch{}, bad
		}
		token := state["memeToken"].(string)
		reverse, e := read(registry, "marketIdByToken(address)", addressArgument(token), []events.Input{{Name: "id", Type: "bytes32"}})
		if e != nil || reverse["id"] != id {
			return ObservationBatch{}, bad
		}
		found := MarketDiscovery{MarketID: id, State: state}
		if state["creatorFeesToHolders"] == true {
			code, e := rpc.CodeAt(ctx, token, block.Hash)
			if e != nil || len(code) == 0 {
				return ObservationBatch{}, bad
			}
			found.Contracts = []Contract{{Module: "TickerMemeTokenV1", Address: token, RuntimeCodeHash: Hash(code)}}
		}
		markets[id] = found
	}
	batch, e := ObserveHolderBlock(ctx, rpc, manifest, block, markets, historical...)
	if e != nil || batch.ChainID != manifest.ChainID || batch.BlockHash != block.Hash || batch.BlockNumber != block.Number || batch.Expected != len(batch.Observations) {
		return ObservationBatch{}, bad
	}
	// Observation jobs deliberately retain failed checks for diagnosis; a verifier
	// must reject them rather than treating successful collection as reconciliation.
	for _, o := range batch.Observations {
		checks, ok := o.Value["checks"].(map[string]bool)
		if o.Kind == "treasurySolvency" || o.Kind == "holderEpoch" {
			if !ok || len(checks) == 0 {
				return ObservationBatch{}, bad
			}
		}
		for _, pass := range checks {
			if !pass {
				return ObservationBatch{}, bad
			}
		}
	}
	end, e := rpc.Header(ctx, block.Number)
	if e != nil || end.Hash != block.Hash {
		return ObservationBatch{}, bad
	}
	for _, id := range ids {
		batch.Observations = append(batch.Observations, StateObservation{Kind: "market", Key: id, Value: markets[id].State})
	}
	batch.Scope = "known-holder-coverage-v1"
	batch.Expected = len(batch.Observations)
	return batch, nil
}
