package deployment

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// StateObservation is an end-of-block view. It intentionally has no transaction
// provenance: triggers select reads but cannot establish transaction-time state.
type StateObservation struct {
	Kind  string         `json:"kind"`
	Key   string         `json:"key"`
	Value map[string]any `json:"value"`
}

const ObservationScope = "market-curve-gauge-v1"

type ObservationBatch struct {
	Scope        string             `json:"scope"`
	ChainID      uint64             `json:"chainId"`
	BlockNumber  string             `json:"blockNumber"`
	BlockHash    string             `json:"blockHash"`
	Expected     int                `json:"expected"`
	Observations []StateObservation `json:"observations"`
}

// ObserveBusinessBlock authenticates event emitters and refreshes each touched
// market and emitting Curve once. This scope does not cover Vault balances,
// FeeVault liabilities, pool keys, configuration records or financial reconciliation.
// Every read is hash-pinned and all results are discarded on failure.
type GaugeAccount struct{ User, MarketID string }

func ObserveBusinessBlock(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, markets map[string]MarketDiscovery, logs []chainrpc.Log, history ...GaugeAccount) (ObservationBatch, error) {
	return observeBusinessBlock(ctx, rpc, m, block, markets, logs, false, history...)
}

// ObserveDirectoryBlock includes every discovered market and Curve, even on
// blocks without business events. All observations refer to the same block hash;
// this provides directory inputs, not independently reconciled publication.
func ObserveDirectoryBlock(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, markets map[string]MarketDiscovery, logs []chainrpc.Log, history ...GaugeAccount) (ObservationBatch, error) {
	if len(markets) > 1000 {
		return ObservationBatch{}, errors.New("directory observation market budget exceeded")
	}
	return observeBusinessBlock(ctx, rpc, m, block, markets, logs, true, history...)
}

func observeBusinessBlock(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, markets map[string]MarketDiscovery, logs []chainrpc.Log, directory bool, history ...GaugeAccount) (ObservationBatch, error) {
	fail := func(err error) (ObservationBatch, error) { return ObservationBatch{}, err }
	v, err := VerifyCoreBindings(ctx, rpc, m, block)
	if err != nil {
		return fail(err)
	}
	registry := ""
	for _, c := range m.Contracts {
		if c.Module == "MarketRegistryV1" {
			registry = c.Address
		}
	}
	ids, curves := map[string]bool{}, map[string]string{}
	users := map[string]map[string]bool{}
	byCurve := map[string]string{}
	for id, market := range markets {
		curve, ok := market.State["curve"].(string)
		if !ok {
			return fail(errors.New("invalid discovered curve identity"))
		}
		if old, exists := byCurve[curve]; exists && old != id {
			return fail(errors.New("ambiguous discovered curve identity"))
		}
		byCurve[curve] = id
		if directory {
			ids[id] = true
			curves[curve] = id
		}
	}

	if len(history) > 10000 {
		return fail(errors.New("Gauge account budget exceeded"))
	}
	// Enabled Gauges have time-dependent state even without an event this block.
	for id, market := range markets {
		if market.State["stakingEnabled"] == true {
			ids[id] = true
		}
	}
	for _, account := range history {
		market, ok := markets[account.MarketID]
		if !ok || market.State["stakingEnabled"] != true || !hex20.MatchString(account.User) || account.User == zero20 {
			return fail(errors.New("invalid historical Gauge account"))
		}
		if users[account.MarketID] == nil {
			users[account.MarketID] = map[string]bool{}
		}
		users[account.MarketID][account.User] = true
	}
	for _, log := range logs {
		if !strings.EqualFold(log.BlockHash, block.Hash) || log.BlockNumber != block.Number {
			return fail(errors.New("observation source block mismatch"))
		}
		event, e := v.Decode(m.ChainID, log)
		if errors.Is(e, events.ErrUnknown) {
			continue
		}
		if e != nil {
			return fail(e)
		}
		if id, ok := event.Args["marketId"].(string); ok {
			if _, exists := markets[id]; !exists {
				return fail(errors.New("observation market lacks discovery"))
			}
			ids[id] = true
			if user, ok := event.Args["user"].(string); ok && user != zero20 {
				if users[id] == nil {
					users[id] = map[string]bool{}
				}
				users[id][user] = true
			}
			if event.Module == "MemeStockGauge" && markets[id].State["gauge"] != event.Emitter {
				return fail(errors.New("Gauge event market mismatch"))
			}
		}
		if event.Module == "TickerGardenCurve" {
			id, ok := byCurve[event.Emitter]
			if !ok {
				return fail(errors.New("observation curve lacks discovery"))
			}
			if eventID, ok := event.Args["marketId"].(string); ok && eventID != id {
				return fail(errors.New("curve event market mismatch"))
			}
			ids[id] = true
			curves[event.Emitter] = id
		}
	}
	batch := ObservationBatch{Scope: ObservationScope, ChainID: m.ChainID, BlockNumber: block.Number, BlockHash: block.Hash, Expected: len(ids) + len(curves), Observations: []StateObservation{}}
	for id := range ids {
		if markets[id].State["stakingEnabled"] == true {
			batch.Expected += 1 + len(users[id])
		}
	}
	read := func(address, signature, args string, fields []events.Input) (map[string]any, error) {
		raw, e := rpc.CallAt(ctx, address, Hash([]byte(signature))[:10]+args, block.Hash)
		if e != nil {
			return nil, fmt.Errorf("business observation failed: %s", signature)
		}
		return events.DecodeStatic(fields, raw)
	}
	keys := func(values map[string]bool) []string {
		out := []string{}
		for key := range values {
			out = append(out, key)
		}
		sort.Strings(out)
		return out
	}
	states := map[string]map[string]any{}
	for _, id := range keys(ids) {
		state, e := read(registry, "market(bytes32)", id[2:], marketFields)
		if e != nil {
			return fail(e)
		}
		if e = validateMarketState(state); e != nil {
			return fail(e)
		}
		// MarketConfig is immutable; only the three MarketRuntime fields may change.
		for _, field := range marketFields[:17] {
			if state[field.Name] != markets[id].State[field.Name] {
				return fail(fmt.Errorf("market observation identity changed: %s", field.Name))
			}
		}
		if markets[id].State["launchPhase"] == "1" {
			for _, field := range marketFields[17:] {
				if state[field.Name] != markets[id].State[field.Name] {
					return fail(errors.New("graduated market runtime changed"))
				}
			}
		}
		token := state["memeToken"].(string)
		reverse, e := read(registry, "marketIdByToken(address)", strings.Repeat("0", 24)+token[2:], []events.Input{{Name: "id", Type: "bytes32"}})
		if e != nil {
			return fail(e)
		}
		if reverse["id"] != id {
			return fail(errors.New("market observation reverse identity mismatch"))
		}
		states[id] = state
		batch.Observations = append(batch.Observations, StateObservation{Kind: "market", Key: id, Value: state})
	}
	curveKeys := map[string]bool{}
	for address := range curves {
		curveKeys[address] = true
	}
	for _, address := range keys(curveKeys) {
		state := map[string]any{"marketId": curves[address]}
		for _, getter := range []struct {
			signature string
			fields    []events.Input
		}{
			{"quoteAsset()", []events.Input{{Name: "quoteAsset", Type: "address"}}},
			{"getReserves()", []events.Input{{Name: "quoteReserve", Type: "uint256"}, {Name: "tokenReserve", Type: "uint256"}}},
			{"realQuoteReserve()", []events.Input{{Name: "realQuoteReserve", Type: "uint256"}}},
			{"sellableTokens()", []events.Input{{Name: "sellableTokens", Type: "uint256"}}},
			{"reservedTokens()", []events.Input{{Name: "reservedTokens", Type: "uint256"}}},
			{"readyToGraduate()", []events.Input{{Name: "readyToGraduate", Type: "bool"}}},
			{"creatorTaxBps()", []events.Input{{Name: "creatorTaxBps", Type: "uint16"}}},
			{"accruedCurveFees()", []events.Input{{Name: "accruedCurveFees", Type: "uint256"}}},
			{"accruedCreatorTax()", []events.Input{{Name: "accruedCreatorTax", Type: "uint256"}}},
			{"sweepNonce()", []events.Input{{Name: "sweepNonce", Type: "uint64"}}},
		} {
			values, e := read(address, getter.signature, "", getter.fields)
			if e != nil {
				return fail(e)
			}
			for name, value := range values {
				state[name] = value
			}
		}
		market := states[curves[address]]
		if state["quoteAsset"] != market["quoteAsset"] || state["creatorTaxBps"] != market["creatorTaxBps"] {
			return fail(errors.New("curve observation binding mismatch"))
		}
		batch.Observations = append(batch.Observations, StateObservation{Kind: "curve", Key: address, Value: state})
	}
	for _, id := range keys(ids) {
		if states[id]["stakingEnabled"] != true {
			continue
		}
		observations, e := observeGauge(ctx, rpc, m, block, markets[id], states[id], users[id])
		if e != nil {
			return fail(e)
		}
		batch.Observations = append(batch.Observations, observations...)
	}
	end, e := rpc.Header(ctx, block.Number)
	if e != nil {
		return fail(e)
	}
	if !strings.EqualFold(end.Hash, block.Hash) {
		return fail(errors.New("business observation block changed"))
	}
	return batch, nil
}
