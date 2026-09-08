package deployment

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
)

func rewardRouteFixture(t *testing.T) (*rewardHeaderFixture, chainrpc.Header, string, ExternalRuntime, map[string]string) {
	t.Helper()
	d, b, id, keys := routeFixture(t, true)
	b.Timestamp = fmt.Sprintf("0x%x", time.Now().Unix())
	f := &rewardHeaderFixture{discoveryFixture: d, block: b}
	manager := "0x" + strings.Repeat("3", 40)
	hook := "0x" + strings.Repeat("0", 36) + "2044"
	d.code[manager] = []byte{3}
	f.manifest.Contracts = append(f.manifest.Contracts, Contract{Module: "TickerGardenMemeHook", Address: hook, RuntimeCodeHash: Hash([]byte{1})})
	pin := ExternalRuntime{Address: manager, RuntimeCodeHash: Hash([]byte{3})}
	put := func(target, sig, args string, values ...string) {
		var raw []byte
		for _, v := range values {
			raw = append(raw, bytesWord(v)...)
		}
		d.calls[target+Hash([]byte(sig))[:10]+args] = raw
	}
	roots := map[string]string{}
	for _, c := range f.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	vault, registry := roots["ProtocolFeeVault"], roots["MarketRegistryV1"]
	put(hook, "marketRegistry()", "", registry)
	put(hook, "protocolFeeVault()", "", vault)
	put(hook, "poolManager()", "", manager)
	put(hook, "hookPermissionMask()", "", wordHex("2044"))
	put(vault, "poolManager()", "", manager)
	pool := Hash(f.calls[keys["canonicalPoolKey(bytes32)"]])
	raw, _ := hex.DecodeString(pool[2:] + fmt.Sprintf("%064x", 6))
	slot := Hash(raw)
	pos, _ := new(big.Int).SetString(slot[2:], 16)
	pos.Add(pos, big.NewInt(3))
	put(manager, "extsload(bytes32)", slot[2:], "1000000000000000000000000")
	put(manager, "extsload(bytes32)", fmt.Sprintf("%064x", pos), "64")
	return f, b, id, pin, keys
}

func TestObserveRewardConversionRouteSuccess(t *testing.T) {
	f, b, id, pin, _ := rewardRouteFixture(t)
	got, err := ObserveRewardConversionRoute(context.Background(), f, f.manifest, b, id, pin)
	if err != nil || got.Hook == "" || got.PoolID == "" {
		t.Fatalf("route failed: %+v %v", got, err)
	}
}

func TestObserveRewardConversionRouteRejectsInconsistencies(t *testing.T) {
	for _, name := range []string{"manager", "hash", "manifest", "binding", "permission", "abi", "stale", "reorg", "vault manager", "hook manager", "hook vault", "binding status", "market pool", "active version", "hook runtime"} {
		t.Run(name, func(t *testing.T) {
			f, b, id, pin, keys := rewardRouteFixture(t)
			hook := "0x" + strings.Repeat("0", 36) + "2044"
			switch name {
			case "manager":
				pin.Address = "0x" + strings.Repeat("4", 40)
			case "hash":
				pin.RuntimeCodeHash = Hash([]byte{1})
			case "manifest":
				f.manifest.Contracts = f.manifest.Contracts[:len(f.manifest.Contracts)-1]
			case "binding":
				pool := Hash(f.calls[keys["canonicalPoolKey(bytes32)"]])
				f.calls[hook+Hash([]byte("poolBinding(bytes32)"))[:10]+pool[2:]] = []byte{1}
			case "permission":
				f.calls[hook+Hash([]byte("hookPermissionMask()"))[:10]] = bytesWord("1")
			case "abi":
				f.calls[keys["canonicalPoolKey(bytes32)"]] = []byte{1}
			case "vault manager", "hook manager", "hook vault":
				target, sig := hook, "poolManager()"
				if name == "vault manager" {
					target = f.manifest.Contracts[6].Address
				}
				if name == "hook vault" {
					sig = "protocolFeeVault()"
				}
				f.calls[target+Hash([]byte(sig))[:10]] = bytesWord("0x" + strings.Repeat("9", 40))
			case "binding status":
				pool := Hash(f.calls[keys["canonicalPoolKey(bytes32)"]])
				key := hook + Hash([]byte("poolBinding(bytes32)"))[:10] + pool[2:]
				copy(f.calls[key][128:], bytesWord("2"))
			case "market pool":
				key := f.manifest.Contracts[5].Address + Hash([]byte("market(bytes32)"))[:10] + id[2:]
				copy(f.calls[key][17*32:18*32], bytesWord(wordHex("ee")))
			case "active version":
				copy(f.calls[keys["activeFeeSource(bytes32)"]][32:], bytesWord("3"))
			case "hook runtime":
				f.code[hook] = []byte{7}
			case "stale":
				b.Timestamp = "0x1"
			case "reorg":
				f.finalReorg = true
			}
			got, err := ObserveRewardConversionRoute(context.Background(), f, f.manifest, b, id, pin)
			if err == nil || got.PoolID != "" || got.Hook != "" {
				t.Fatalf("accepted partial route: %+v %v", got, err)
			}
		})
	}
}
