package deployment

import (
	"context"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

func TestObserveMarketRouteRejectsInvalidAndNeverReturnsPartial(t *testing.T) {
	f := newBindingFixture()
	b := chainrpc.Header{Number: "0x1", Hash: blockHash}
	for _, id := range []string{"", zero32, "0x1234", "not-a-market"} {
		if batch, err := ObserveMarketRoute(context.Background(), f, f.manifest, b, id); err == nil || len(batch.Observations) != 0 {
			t.Fatalf("accepted invalid route %q: batch=%+v err=%v", id, batch, err)
		}
	}
	f.callError = true
	id := "0x" + strings.Repeat("1", 64)
	if _, err := ObserveMarketRoute(context.Background(), f, f.manifest, b, id); err == nil {
		t.Fatal("accepted unavailable route reads")
	}
}

func routeFixture(t *testing.T, graduated bool) (*discoveryFixture, chainrpc.Header, string, map[string]string) {
	t.Helper()
	f, b, id := discoverySetup(t, false, graduated)
	roots := map[string]string{}
	for _, c := range f.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	registry := roots["MarketRegistryV1"]
	raw := f.calls[registry+Hash([]byte("market(bytes32)"))[:10]+id[2:]]
	state, e := events.DecodeStatic(marketFields, raw)
	if e != nil {
		t.Fatal(e)
	}
	pool := []byte{}
	for _, word := range []string{state["memeToken"].(string), state["quoteAsset"].(string), "0", "3c", state["graduatedHook"].(string)} {
		pool = append(pool, bytesWord(word)...)
	}
	pid := Hash(pool)
	if graduated {
		copy(raw[17*32:18*32], bytesWord(pid))
	}
	keys := map[string]string{}
	put := func(address, sig, args string, value []byte) {
		key := address + Hash([]byte(sig))[:10] + args
		f.calls[key] = value
		keys[sig] = key
	}
	put(registry, "canonicalPoolKey(bytes32)", id[2:], pool)
	put(registry, "canonicalPoolId(bytes32)", id[2:], bytesWord(pid))
	locker := "0x" + strings.Repeat("e", 40)
	router, quoter := roots["AllocationManager"], roots["LaunchAndBuyRouter"]
	route := append([]byte{}, pool...)
	curveOn, poolOn := "1", "0"
	if graduated {
		curveOn, poolOn = "0", "1"
	}
	for _, word := range []string{pid, router, quoter, state["graduatedHook"].(string), state["quoteAsset"].(string), state["memeToken"].(string), zero20, state["curve"].(string), locker, state["sourceVersion"].(string), state["launchPhase"].(string), curveOn, poolOn} {
		route = append(route, bytesWord(word)...)
	}
	put(registry, "canonicalRoute(bytes32)", id[2:], route)
	put(registry, "swapRouter()", "", bytesWord(router))
	put(registry, "quoter()", "", bytesWord(quoter))
	put(registry, "graduationExecutor()", "", bytesWord(roots["ProtocolFeeVault"]))
	source := state["curve"].(string)
	if graduated {
		source = state["graduatedHook"].(string)
	}
	put(registry, "activeFeeSource(bytes32)", id[2:], append(bytesWord(source), bytesWord(state["sourceVersion"].(string))...))
	hook := state["graduatedHook"].(string)
	f.code[hook] = []byte{1}
	f.code[locker] = []byte{2}
	put(hook, "marketRegistry()", "", bytesWord(registry))
	binding := []byte{}
	for _, word := range []string{id, pid, "2", "ffffffffffffffff", "3"} {
		binding = append(binding, bytesWord(word)...)
	}
	put(hook, "poolBinding(bytes32)", pid[2:], binding)
	put(locker, "marketId()", "", bytesWord(id))
	put(locker, "lockedPosition()", "", append(bytesWord("1"), bytesWord(pid)...))
	return f, b, id, keys
}
func TestMarketRouteCurveAndGraduated(t *testing.T) {
	for _, graduated := range []bool{false, true} {
		f, b, id, _ := routeFixture(t, graduated)
		batch, e := ObserveMarketRoute(context.Background(), f, f.manifest, b, id)
		if e != nil {
			t.Fatal(e)
		}
		want := 3
		if graduated {
			want = 5
		}
		if batch.Expected != want || len(batch.Observations) != want || batch.BlockHash != b.Hash {
			t.Fatal(batch)
		}
	}
}
func TestMarketRouteRejectsCrossBindingAndABIChanges(t *testing.T) {
	for _, kind := range []string{"hash", "key currency", "key fee", "route bool", "route gauge", "source", "hook registry", "binding market", "binding status", "locker market", "locker token", "locker pool", "trailing"} {
		t.Run(kind, func(t *testing.T) {
			f, b, id, keys := routeFixture(t, true)
			replace := func(sig string, index int, word string) {
				copy(f.calls[keys[sig]][index*32:(index+1)*32], bytesWord(word))
			}
			switch kind {
			case "hash":
				replace("canonicalPoolId(bytes32)", 0, zero32)
			case "key currency":
				replace("canonicalPoolKey(bytes32)", 0, zero20)
			case "key fee":
				replace("canonicalPoolKey(bytes32)", 2, "1")
			case "route bool":
				replace("canonicalRoute(bytes32)", 17, "2")
			case "route gauge":
				replace("canonicalRoute(bytes32)", 11, wordHex("1"))
			case "source":
				replace("activeFeeSource(bytes32)", 1, "1")
			case "hook registry":
				replace("marketRegistry()", 0, zero20)
			case "binding market":
				replace("poolBinding(bytes32)", 0, zero32)
			case "binding status":
				replace("poolBinding(bytes32)", 4, "2")
			case "locker market":
				replace("marketId()", 0, zero32)
			case "locker token":
				replace("lockedPosition()", 0, "0")
			case "locker pool":
				replace("lockedPosition()", 1, zero32)
			case "trailing":
				k := keys["canonicalPoolKey(bytes32)"]
				f.calls[k] = append(f.calls[k], 0)
			}
			batch, e := ObserveMarketRoute(context.Background(), f, f.manifest, b, id)
			if e == nil || len(batch.Observations) != 0 {
				t.Fatal("bad binding or partial result accepted", kind)
			}
		})
	}
}

type lateRouteChange struct {
	*discoveryFixture
	done bool
}

func (f *lateRouteChange) CallAt(ctx context.Context, a, data, h string) ([]byte, error) {
	result, e := f.discoveryFixture.CallAt(ctx, a, data, h)
	if strings.HasPrefix(data, Hash([]byte("lockedPosition()"))[:10]) {
		f.done = true
	}
	return result, e
}
func (f *lateRouteChange) Header(ctx context.Context, tag string) (chainrpc.Header, error) {
	h, e := f.discoveryFixture.Header(ctx, tag)
	if f.done {
		h.Hash = genesisHash
	}
	return h, e
}
func TestRouteLateReorgDiscardsCompleteObservations(t *testing.T) {
	f, b, id, _ := routeFixture(t, true)
	rpc := &lateRouteChange{discoveryFixture: f}
	batch, e := ObserveMarketRoute(context.Background(), rpc, f.manifest, b, id)
	if !rpc.done || e == nil || len(batch.Observations) != 0 {
		t.Fatal("late source change accepted or failed before final read")
	}
}

func TestMarketRouteExecutorEvidence(t *testing.T) {
	for _, mode := range []string{"valid", "missing", "zero", "padding", "empty code"} {
		t.Run(mode, func(t *testing.T) {
			f, b, id, keys := routeFixture(t, false)
			key := keys["graduationExecutor()"]
			executor := ""
			for _, c := range f.manifest.Contracts {
				if c.Module == "ProtocolFeeVault" {
					executor = c.Address
				}
			}
			switch mode {
			case "missing":
				delete(f.calls, key)
			case "zero":
				f.calls[key] = bytesWord(zero20)
			case "padding":
				f.calls[key][0] = 1
			case "empty code":
				executor = "0x" + strings.Repeat("a", 40)
				f.calls[key] = bytesWord(executor)
				f.code[executor] = nil
			}
			batch, err := ObserveMarketRoute(context.Background(), f, f.manifest, b, id)
			if mode != "valid" {
				if err == nil || len(batch.Observations) != 0 {
					t.Fatal("invalid executor accepted", batch, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if batch.Observations[1].Value["graduationExecutor"] != executor || batch.Observations[2].Value["graduationExecutor"] != Hash([]byte{0}) {
				t.Fatal("missing executor provenance", batch)
			}
		})
	}
}
