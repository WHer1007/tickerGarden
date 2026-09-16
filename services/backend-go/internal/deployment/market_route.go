package deployment

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
	"time"
)

var poolKeyFields = []events.Input{{Name: "currency0", Type: "address"}, {Name: "currency1", Type: "address"}, {Name: "fee", Type: "uint24"}, {Name: "tickSpacing", Type: "int24"}, {Name: "hooks", Type: "address"}}
var routeFields = append(append([]events.Input{}, poolKeyFields...), []events.Input{{Name: "poolId", Type: "bytes32"}, {Name: "swapRouter", Type: "address"}, {Name: "quoter", Type: "address"}, {Name: "hook", Type: "address"}, {Name: "quoteAsset", Type: "address"}, {Name: "memeToken", Type: "address"}, {Name: "gauge", Type: "address"}, {Name: "curve", Type: "address"}, {Name: "launchLocker", Type: "address"}, {Name: "sourceVersion", Type: "uint32"}, {Name: "launchPhase", Type: "uint8"}, {Name: "curveTradingEnabled", Type: "bool"}, {Name: "poolTradingEnabled", Type: "bool"}}...)

// ObserveMarketRoute checks the Registry route and graduated Hook/Locker binding
// at one block. It does not prove pool liquidity, execution quotes or permissions.
func ObserveMarketRoute(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, id string) (ObservationBatch, error) {
	fail := func(e error) (ObservationBatch, error) { return ObservationBatch{}, e }
	id = strings.ToLower(id)
	if !hex32.MatchString(id) || id == zero32 {
		return fail(errors.New("invalid route market"))
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if _, e := VerifyCoreBindings(ctx, rpc, m, block); e != nil {
		return fail(e)
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		roots[c.Module] = c.Address
	}
	registry := roots["MarketRegistryV1"]
	read := businessReader(ctx, rpc, block)
	scalar := func(address, signature, args, typ string) (any, error) {
		v, e := read(address, signature, args, []events.Input{{Name: "value", Type: typ}})
		if e != nil {
			return nil, e
		}
		return v["value"], nil
	}
	state, e := read(registry, "market(bytes32)", id[2:], marketFields)
	if e != nil {
		return fail(e)
	}
	if e = validateMarketState(state); e != nil {
		return fail(e)
	}
	reverse, e := scalar(registry, "marketIdByToken(address)", addressArgument(state["memeToken"].(string)), "bytes32")
	if e != nil || reverse != id {
		return fail(errors.New("route market reverse mismatch"))
	}
	raw, e := rpc.CallAt(ctx, registry, Hash([]byte("canonicalPoolKey(bytes32)"))[:10]+id[2:], block.Hash)
	if e != nil {
		return fail(errors.New("canonical PoolKey unavailable"))
	}
	key, e := events.DecodeStatic(poolKeyFields, raw)
	if e != nil {
		return fail(e)
	}
	poolID := Hash(raw)
	canonical, e := scalar(registry, "canonicalPoolId(bytes32)", id[2:], "bytes32")
	if e != nil || canonical != poolID {
		return fail(errors.New("canonical PoolId mismatch"))
	}
	currencies := []string{state["quoteAsset"].(string), state["memeToken"].(string)}
	if currencies[0] > currencies[1] {
		currencies[0], currencies[1] = currencies[1], currencies[0]
	}
	tick, _ := strconv.ParseInt(key["tickSpacing"].(string), 10, 24)
	if key["currency0"] != currencies[0] || key["currency1"] != currencies[1] || key["hooks"] != state["graduatedHook"] || key["fee"] != "0" || tick < 1 || tick > 32767 {
		return fail(errors.New("canonical PoolKey identity mismatch"))
	}
	route, e := read(registry, "canonicalRoute(bytes32)", id[2:], routeFields)
	if e != nil {
		return fail(e)
	}
	for _, field := range poolKeyFields {
		if !reflect.DeepEqual(route[field.Name], key[field.Name]) {
			return fail(errors.New("route PoolKey mismatch"))
		}
	}
	if route["poolId"] != poolID {
		return fail(errors.New("route PoolId mismatch"))
	}
	for _, field := range []string{"quoteAsset", "memeToken", "gauge", "curve", "sourceVersion", "launchPhase"} {
		if route[field] != state[field] {
			return fail(errors.New("route market state mismatch"))
		}
	}
	graduated := state["launchPhase"] == "1"
	if route["hook"] != state["graduatedHook"] || route["launchLocker"] == zero20 || route["curveTradingEnabled"] != !graduated || route["poolTradingEnabled"] != graduated || (graduated && state["poolId"] != poolID) {
		return fail(errors.New("route lifecycle mismatch"))
	}
	codes := map[string]any{}
	for _, field := range []string{"swapRouter", "quoter"} {
		want, e := scalar(registry, field+"()", "", "address")
		if e != nil || want == zero20 || route[field] != want {
			return fail(errors.New("route endpoint mismatch"))
		}
		code, e := rpc.CodeAt(ctx, want.(string), block.Hash)
		if e != nil || len(code) == 0 {
			return fail(errors.New("route endpoint runtime unavailable"))
		}
		codes[field] = Hash(code)
	}
	executor, e := scalar(registry, "graduationExecutor()", "", "address")
	if e != nil || executor == zero20 {
		return fail(errors.New("route graduation executor unavailable"))
	}
	executorCode, e := rpc.CodeAt(ctx, executor.(string), block.Hash)
	if e != nil || len(executorCode) == 0 {
		return fail(errors.New("route graduation executor runtime unavailable"))
	}
	route["graduationExecutor"] = executor
	codes["graduationExecutor"] = Hash(executorCode)
	active, e := read(registry, "activeFeeSource(bytes32)", id[2:], []events.Input{{Name: "source", Type: "address"}, {Name: "sourceVersion", Type: "uint32"}})
	if e != nil {
		return fail(e)
	}
	feeSource := state["curve"]
	if graduated {
		feeSource = state["graduatedHook"]
	}
	if active["source"] != feeSource || active["sourceVersion"] != state["sourceVersion"] {
		return fail(errors.New("route fee source mismatch"))
	}
	observations := []StateObservation{{Kind: "poolKey", Key: id, Value: key}, {Kind: "canonicalRoute", Key: id, Value: route}, {Kind: "routeRuntime", Key: id, Value: codes}}
	if graduated {
		hook := route["hook"].(string)
		locker := route["launchLocker"].(string)
		for _, target := range []struct{ name, address string }{{"hook", hook}, {"launchLocker", locker}} {
			code, e := rpc.CodeAt(ctx, target.address, block.Hash)
			if e != nil || len(code) == 0 {
				return fail(errors.New("graduated route runtime unavailable"))
			}
			codes[target.name] = Hash(code)
		}
		boundRegistry, e := scalar(hook, "marketRegistry()", "", "address")
		if e != nil || boundRegistry != registry {
			return fail(errors.New("Hook Registry mismatch"))
		}
		binding, e := read(hook, "poolBinding(bytes32)", poolID[2:], []events.Input{{Name: "marketId", Type: "bytes32"}, {Name: "keyHash", Type: "bytes32"}, {Name: "sourceVersion", Type: "uint32"}, {Name: "feeNonce", Type: "uint64"}, {Name: "status", Type: "uint8"}})
		if e != nil {
			return fail(e)
		}
		if binding["marketId"] != id || binding["keyHash"] != poolID || binding["sourceVersion"] != state["sourceVersion"] || binding["status"] != "3" {
			return fail(errors.New("Hook pool binding mismatch"))
		}
		lockerMarket, e := scalar(locker, "marketId()", "", "bytes32")
		if e != nil || lockerMarket != id {
			return fail(errors.New("Locker market mismatch"))
		}
		locked, e := read(locker, "lockedPosition()", "", []events.Input{{Name: "tokenId", Type: "uint256"}, {Name: "poolId", Type: "bytes32"}})
		if e != nil {
			return fail(e)
		}
		if locked["tokenId"] == "0" || locked["poolId"] != poolID {
			return fail(errors.New("Locker position mismatch"))
		}
		observations = append(observations, StateObservation{Kind: "poolBinding", Key: poolID, Value: binding}, StateObservation{Kind: "lockedPosition", Key: locker, Value: locked})
	}
	end, e := rpc.Header(ctx, block.Number)
	if e != nil {
		return fail(e)
	}
	if end.Hash != block.Hash || end.Number != block.Number || end.Timestamp != block.Timestamp {
		return fail(errors.New("route observation block changed"))
	}
	return ObservationBatch{Scope: "market-route-v1", ChainID: m.ChainID, BlockNumber: block.Number, BlockHash: block.Hash, Expected: len(observations), Observations: observations}, nil
}
