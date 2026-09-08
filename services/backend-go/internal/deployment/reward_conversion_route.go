package deployment

import (
	"context"
	"errors"
	"strconv"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// ExternalRuntime is an operator-pinned external dependency, not a protocol module.
type ExternalRuntime struct {
	Address         string `json:"address"`
	RuntimeCodeHash string `json:"runtimeCodeHash"`
}
type RewardConversionRoute struct {
	PoolState   ConversionPoolState `json:"poolState"`
	PoolID      string              `json:"poolId"`
	Hook        string              `json:"hook"`
	PoolManager ExternalRuntime     `json:"poolManager"`
	PoolKey     map[string]any      `json:"poolKey"`
}

// ObserveRewardConversionRoute authenticates the actual direct FeeVault -> Hook
// -> PoolManager route. It does not verify price, liquidity or external consensus.
func ObserveRewardConversionRoute(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, id string, pin ExternalRuntime) (RewardConversionRoute, error) {
	fail := func() (RewardConversionRoute, error) {
		return RewardConversionRoute{}, errors.New("reward conversion route unavailable or inconsistent")
	}
	stamp, e := block.Time()
	now := time.Now().Unix()
	if rpc == nil || e != nil || stamp > uint64(now+5) || now-int64(stamp) > 120 || !hex32.MatchString(id) || id == zero32 || !hex20.MatchString(pin.Address) || pin.Address == zero20 || !hex32.MatchString(pin.RuntimeCodeHash) {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if _, e := VerifyCoreBindings(ctx, rpc, m, block); e != nil {
		return fail()
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		if c.Module == "MarketRegistryV1" || c.Module == "ProtocolFeeVault" {
			roots[c.Module] = c.Address
		}
	}
	read := businessReader(ctx, rpc, block)
	scalar := func(target, sig, args, typ string) (any, error) {
		v, e := read(target, sig, args, []events.Input{{Name: "value", Type: typ}})
		if e != nil {
			return nil, e
		}
		return v["value"], nil
	}
	registry, vault := roots["MarketRegistryV1"], roots["ProtocolFeeVault"]
	market, e := read(registry, "market(bytes32)", id[2:], marketFields)
	if e != nil || validateMarketState(market) != nil || market["launchPhase"] != "1" {
		return fail()
	}
	token := market["memeToken"].(string)
	if v, e := scalar(registry, "marketIdByToken(address)", addressArgument(token), "bytes32"); e != nil || v != id {
		return fail()
	}
	raw, e := rpc.CallAt(ctx, registry, Hash([]byte("canonicalPoolKey(bytes32)"))[:10]+id[2:], block.Hash)
	if e != nil {
		return fail()
	}
	key, e := events.DecodeStatic(poolKeyFields, raw)
	if e != nil {
		return fail()
	}
	pool := Hash(raw)
	if v, e := scalar(registry, "canonicalPoolId(bytes32)", id[2:], "bytes32"); e != nil || v != pool || market["poolId"] != pool {
		return fail()
	}
	a, b := token, market["quoteAsset"].(string)
	if a > b {
		a, b = b, a
	}
	tick, e := strconv.ParseInt(key["tickSpacing"].(string), 10, 24)
	hook := market["graduatedHook"].(string)
	if e != nil || tick < 1 || tick > 32767 || key["currency0"] != a || key["currency1"] != b || key["fee"] != "0" || key["hooks"] != hook {
		return fail()
	}
	manifested := false
	for _, c := range m.Contracts {
		if c.Module == "TickerGardenMemeHook" && c.Address == hook {
			manifested = true
		}
	}
	if !manifested {
		return fail()
	}
	code, e := rpc.CodeAt(ctx, pin.Address, block.Hash)
	if e != nil || len(code) == 0 || Hash(code) != pin.RuntimeCodeHash {
		return fail()
	}
	for _, edge := range []struct{ target, sig, want string }{{hook, "marketRegistry()", registry}, {hook, "protocolFeeVault()", vault}, {hook, "poolManager()", pin.Address}, {vault, "poolManager()", pin.Address}} {
		if v, e := scalar(edge.target, edge.sig, "", "address"); e != nil || v != edge.want {
			return fail()
		}
	}
	permission, e := strconv.ParseUint(hook[len(hook)-4:], 16, 16)
	if e != nil || permission&0x3fff != 0x2044 {
		return fail()
	}
	if v, e := scalar(hook, "hookPermissionMask()", "", "uint160"); e != nil || v != "8260" {
		return fail()
	}
	binding, e := read(hook, "poolBinding(bytes32)", pool[2:], []events.Input{{Name: "marketId", Type: "bytes32"}, {Name: "keyHash", Type: "bytes32"}, {Name: "sourceVersion", Type: "uint32"}, {Name: "feeNonce", Type: "uint64"}, {Name: "status", Type: "uint8"}})
	if e != nil || binding["marketId"] != id || binding["keyHash"] != pool || binding["sourceVersion"] != market["sourceVersion"] || binding["status"] != "3" {
		return fail()
	}
	active, e := read(registry, "activeFeeSource(bytes32)", id[2:], []events.Input{{Name: "source", Type: "address"}, {Name: "sourceVersion", Type: "uint32"}})
	if e != nil || active["source"] != hook || active["sourceVersion"] != market["sourceVersion"] {
		return fail()
	}
	poolState, e := observeConversionPool(ctx, rpc, pin.Address, pool, block.Hash)
	if e != nil {
		return fail()
	}
	last, e := rpc.Header(ctx, block.Number)
	if e != nil || last != block || time.Now().Unix()-int64(stamp) > 120 {
		return fail()
	}
	return RewardConversionRoute{PoolState: poolState, PoolID: pool, Hook: hook, PoolManager: pin, PoolKey: key}, nil
}
