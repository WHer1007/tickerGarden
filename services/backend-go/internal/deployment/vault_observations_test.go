package deployment

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

func vaultFixture(t *testing.T) (*discoveryFixture, chainrpc.Header, MarketDiscovery, string, string, string, chainrpc.Log) {
	t.Helper()
	f, b, market, user, _ := gaugeFixture(t)
	id := market.State["assetUid"].(string)
	vault := "0x" + strings.Repeat("4", 40)
	token := "0x" + strings.Repeat("5", 40)
	roots := map[string]string{}
	for _, c := range f.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	registry := roots["OfficialStockRegistryV1"]
	encode := func(values ...string) []byte {
		raw := []byte{}
		for _, value := range values {
			raw = append(raw, bytesWord(value)...)
		}
		return raw
	}
	f.code[vault] = []byte{2}
	f.code[token] = []byte{3}
	f.calls[registry+Hash([]byte("asset(bytes32)"))[:10]+id[2:]] = encode(token, vault, "12", "1")
	f.calls[registry+Hash([]byte("minimumAllocation(bytes32)"))[:10]+id[2:]] = encode("19e")
	f.calls[registry+Hash([]byte("assetFingerprint(bytes32)"))[:10]+id[2:]] = encode(Hash(f.code[token]), zero20, zero32, token, Hash(f.code[token]))
	for _, p := range []struct{ signature, arg string }{{"assetIdentityCurrent(bytes32)", id[2:]}, {"vaultIdentityCurrent(address)", addressArgument(vault)}} {
		f.calls[registry+Hash([]byte(p.signature))[:10]+p.arg] = encode("1")
	}
	f.calls[vault+Hash([]byte("vaultIdentity()"))[:10]] = encode(registry, roots["MarketRegistryV1"], roots["AllocationManager"], vaultSchema)
	f.calls[registry+Hash([]byte("vaultSchemaId(address)"))[:10]+addressArgument(vault)] = encode(vaultSchema)
	f.calls[registry+Hash([]byte("vaultForSchema(bytes32)"))[:10]+vaultSchema[2:]] = encode(vault)
	f.calls[registry+Hash([]byte("vaultRuntimeCodeHash(address)"))[:10]+addressArgument(vault)] = encode(Hash(f.code[vault]))
	f.calls[vault+Hash([]byte("totalDeposited(bytes32)"))[:10]+id[2:]] = encode("64")
	f.calls[vault+Hash([]byte("totalAllocated(bytes32)"))[:10]+id[2:]] = encode("3c")
	f.calls[token+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(vault)] = encode("64")
	for _, p := range []struct{ name, value string }{{"deposited", "5a"}, {"allocated", "32"}, {"freeBalanceOf", "28"}} {
		f.calls[vault+Hash([]byte(p.name + "(bytes32,address)"))[:10]+id[2:]+addressArgument(user)] = encode(p.value)
	}
	for _, p := range []struct{ name, value string }{{"marketAllocated", "3c"}, {"marketRewardEligible", "28"}, {"marketRewardCohortEpoch", "2"}} {
		f.calls[vault+Hash([]byte(p.name + "(bytes32,bytes32)"))[:10]+id[2:]+market.MarketID[2:]] = encode(p.value)
	}
	args := id[2:] + addressArgument(user) + market.MarketID[2:]
	f.calls[vault+Hash([]byte("allocation(bytes32,address,bytes32)"))[:10]+args] = encode("32")
	f.calls[vault+Hash([]byte("rageQuitRewardCutoff(bytes32,address,bytes32)"))[:10]+args] = encode("0", "0", "0", "0")
	log := chainrpc.Log{Address: vault, BlockNumber: b.Number, BlockHash: b.Hash, Topics: []string{Hash([]byte("AllocationLocked(bytes32,address,bytes32,uint256,uint256,uint256)")), id, wordHex(user[2:]), market.MarketID}, Data: "0x" + hex.EncodeToString(encode("32", "32", "32"))}
	return f, b, market, user, vault, token, log
}

func TestVaultIdentityAndPrincipalObservations(t *testing.T) {
	f, b, market, _, vault, _, log := vaultFixture(t)
	id := market.State["assetUid"].(string)
	assets, err := DiscoverAssets(context.Background(), f, f.manifest, b, map[string]bool{id: true})
	if err != nil {
		t.Fatal(err)
	}
	f.manifest.Contracts = append(f.manifest.Contracts, assets[id].Vault)
	verified, err := VerifyCoreBindings(context.Background(), f, f.manifest, b)
	if err != nil {
		t.Fatal(err)
	}
	batch, err := ObserveAssetBlock(context.Background(), f, b, f.manifest.ChainID, verified, assets, map[string]MarketDiscovery{market.MarketID: market}, []chainrpc.Log{log, log})
	if err != nil || batch.Expected != 5 || len(batch.Observations) != 5 {
		t.Fatal(batch, err)
	}
	if assets[id].Vault.Address != vault {
		t.Fatal("wrong Vault")
	}
	for _, row := range batch.Observations {
		if checks, ok := row.Value["checks"].(map[string]bool); ok {
			for name, passed := range checks {
				want := name != "knownUserSumEqualsDeposited" && name != "knownUserSumEqualsAllocated" && name != "knownUserSumEqualsMarketAllocated"
				if passed != want {
					t.Fatal(name, row)
				}
			}
		}
	}
	if batch.Observations[4].Value["allocation"] != "50" {
		t.Fatal(batch)
	}
}

func TestVaultFailedChecksRemainVisible(t *testing.T) {
	f, b, market, user, vault, token, _ := vaultFixture(t)
	id := market.State["assetUid"].(string)
	assets, err := DiscoverAssets(context.Background(), f, f.manifest, b, map[string]bool{id: true})
	if err != nil {
		t.Fatal(err)
	}
	f.calls[token+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(vault)] = bytesWord("63")
	f.calls[vault+Hash([]byte("freeBalanceOf(bytes32,address)"))[:10]+id[2:]+addressArgument(user)] = bytesWord("29")
	rows, err := observeVault(context.Background(), f, b, assets[id], map[string]bool{user: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rows[1].Value["checks"].(map[string]bool)["balanceCoversDeposits"] || rows[2].Value["checks"].(map[string]bool)["freeEqualsDepositedMinusAllocated"] {
		t.Fatal("lost failed check evidence")
	}
	if rows[1].Value["fullReconciliation"] != false {
		t.Fatal("overclaimed reconciliation")
	}
}

func TestVaultRejectsIdentityDriftAndMalformedViews(t *testing.T) {
	for _, name := range []string{"asset predicate", "vault predicate", "schema", "reverse schema", "runtime", "token runtime", "officialStockRegistry", "marketRegistry", "allocationManager", "schemaId", "unset", "decimals"} {
		t.Run(name, func(t *testing.T) {
			f, b, market, _, vault, token, _ := vaultFixture(t)
			id := market.State["assetUid"].(string)
			registry := f.manifest.Contracts[1].Address
			switch name {
			case "asset predicate":
				f.calls[registry+Hash([]byte("assetIdentityCurrent(bytes32)"))[:10]+id[2:]] = bytesWord("0")
			case "vault predicate":
				f.calls[registry+Hash([]byte("vaultIdentityCurrent(address)"))[:10]+addressArgument(vault)] = bytesWord("0")
			case "schema":
				f.calls[registry+Hash([]byte("vaultSchemaId(address)"))[:10]+addressArgument(vault)] = bytesWord("1")
			case "reverse schema":
				f.calls[registry+Hash([]byte("vaultForSchema(bytes32)"))[:10]+vaultSchema[2:]] = bytesWord(zero20)
			case "runtime":
				f.code[vault] = []byte{9}
			case "token runtime":
				f.code[token] = []byte{9}
			case "unset":
				f.calls[registry+Hash([]byte("asset(bytes32)"))[:10]+id[2:]][127] = 0
			case "decimals":
				f.calls[registry+Hash([]byte("asset(bytes32)"))[:10]+id[2:]][95] = 19
			default:
				for i, field := range vaultIdentityFields {
					if name == field.Name {
						f.calls[vault+Hash([]byte("vaultIdentity()"))[:10]][i*32+31] ^= 1
					}
				}
			}
			got, err := DiscoverAssets(context.Background(), f, f.manifest, b, map[string]bool{id: true})
			if err == nil || got != nil {
				t.Fatalf("accepted %s: %v", name, err)
			}
		})
	}
}

func TestVaultPausedRetiredAndEmptyBlock(t *testing.T) {
	for _, status := range []byte{2, 3} {
		f, b, market, _, _, _, _ := vaultFixture(t)
		id := market.State["assetUid"].(string)
		registry := f.manifest.Contracts[1].Address
		f.calls[registry+Hash([]byte("asset(bytes32)"))[:10]+id[2:]][127] = status
		assets, err := DiscoverAssets(context.Background(), f, f.manifest, b, map[string]bool{id: true})
		if err != nil {
			t.Fatal(err)
		}
		v, err := VerifyCoreBindings(context.Background(), f, f.manifest, b)
		if err != nil {
			t.Fatal(err)
		}
		batch, err := ObserveAssetBlock(context.Background(), f, b, f.manifest.ChainID, v, assets, nil, nil)
		if err != nil || batch.Expected != 2 || len(batch.Observations) != 2 {
			t.Fatal(batch, err)
		}
	}
}

func TestVaultABIFieldsMatchCompiledManifest(t *testing.T) {
	raw, err := os.ReadFile("../../../../spec/v1_compiled_interface_manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		CompiledSourceTypes struct {
			Structs map[string][]string `json:"structs"`
		} `json:"compiledSourceTypes"`
	}
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for name, fields := range map[string][]events.Input{"AssetView": assetFields, "StockTokenFingerprint": fingerprintFields} {
		actual := []string{}
		for _, field := range fields {
			actual = append(actual, field.Type+" "+field.Name)
		}
		if !reflect.DeepEqual(actual, manifest.CompiledSourceTypes.Structs[name]) {
			t.Fatal("ABI drift", name)
		}
	}
}

func TestVaultMaxAmountsAndLateFailure(t *testing.T) {
	f, b, market, user, vault, token, _ := vaultFixture(t)
	id := market.State["assetUid"].(string)
	assets, err := DiscoverAssets(context.Background(), f, f.manifest, b, map[string]bool{id: true})
	if err != nil {
		t.Fatal(err)
	}
	max := strings.Repeat("f", 64)
	less := strings.Repeat("f", 63) + "e"
	for _, signature := range []string{"totalDeposited(bytes32)", "totalAllocated(bytes32)"} {
		value := max
		if strings.Contains(signature, "Allocated") {
			value = less
		}
		f.calls[vault+Hash([]byte(signature))[:10]+id[2:]] = bytesWord(value)
	}
	f.calls[token+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(vault)] = bytesWord(max)
	for _, p := range []struct{ name, value string }{{"deposited", max}, {"allocated", less}, {"freeBalanceOf", "1"}} {
		f.calls[vault+Hash([]byte(p.name + "(bytes32,address)"))[:10]+id[2:]+addressArgument(user)] = bytesWord(p.value)
	}
	rows, err := observeVault(context.Background(), f, b, assets[id], map[string]bool{user: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rows[2].Value["checks"].(map[string]bool)["freeEqualsDepositedMinusAllocated"] != true {
		t.Fatal("uint256 arithmetic lost precision")
	}
	delete(f.calls, vault+Hash([]byte("freeBalanceOf(bytes32,address)"))[:10]+id[2:]+addressArgument(user))
	rows, err = observeVault(context.Background(), f, b, assets[id], map[string]bool{user: true}, nil)
	if err == nil || rows != nil {
		t.Fatal("late getter failure leaked partial rows")
	}
}

func TestVaultObservationRejectsCrossBlockIdentity(t *testing.T) {
	f, b, market, _, _, _, _ := vaultFixture(t)
	id := market.State["assetUid"].(string)
	assets, err := DiscoverAssets(context.Background(), f, f.manifest, b, map[string]bool{id: true})
	if err != nil {
		t.Fatal(err)
	}
	v, err := VerifyCoreBindings(context.Background(), f, f.manifest, b)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ObserveAssetBlock(context.Background(), f, b, f.manifest.ChainID, Verified{}, assets, nil, nil); err == nil {
		t.Fatal("accepted unverified empty block")
	}
	asset := assets[id]
	asset.BlockHash = genesisHash
	assets[id] = asset
	if _, err = ObserveAssetBlock(context.Background(), f, b, f.manifest.ChainID, v, assets, nil, nil); err == nil {
		t.Fatal("accepted stale asset identity")
	}
}

func TestAssetMinimumAllocationObservation(t *testing.T) {
	for _, mode := range []string{"floor", "below", "missing"} {
		t.Run(mode, func(t *testing.T) {
			f, b, market, _, _, _, _ := vaultFixture(t)
			id := market.State["assetUid"].(string)
			registry := ""
			for _, c := range f.manifest.Contracts {
				if c.Module == "OfficialStockRegistryV1" {
					registry = c.Address
				}
			}
			key := registry + Hash([]byte("minimumAllocation(bytes32)"))[:10] + id[2:]
			if mode == "below" {
				f.calls[key] = bytesWord("19d")
			}
			if mode == "missing" {
				delete(f.calls, key)
			}
			assets, e := DiscoverAssets(context.Background(), f, f.manifest, b, map[string]bool{id: true})
			if mode == "floor" {
				if e != nil || assets[id].State["minimumAllocation"] != "414" {
					t.Fatal(assets, e)
				}
			} else if e == nil || assets != nil {
				t.Fatal("invalid minimum accepted", assets, e)
			}
		})
	}
}
