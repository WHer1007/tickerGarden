package deployment

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"tickergarden/backend/internal/events"

	"tickergarden/backend/internal/chainrpc"
)

func gaugeFixture(t *testing.T) (*discoveryFixture, chainrpc.Header, MarketDiscovery, string, chainrpc.Log) {
	t.Helper()
	f, b, id := discoverySetup(t, true, false)
	b.Timestamp = "0x64"
	found, err := DiscoverBlock(context.Background(), f, f.manifest, b)
	if err != nil {
		t.Fatal(err)
	}
	market := found[0]
	gauge := market.State["gauge"].(string)
	for _, c := range market.Contracts {
		f.manifest.Contracts = append(f.manifest.Contracts, c)
	}
	roots := map[string]string{}
	for _, c := range f.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	encode := func(values ...string) []byte {
		out := []byte{}
		for _, v := range values {
			out = append(out, bytesWord(v)...)
		}
		return out
	}
	f.calls[gauge+Hash([]byte("gaugeIdentity()"))[:10]] = encode(id, market.State["assetUid"].(string), market.State["quoteAssetConfigId"].(string), roots["AllocationManager"], roots["ProtocolFeeVault"], market.State["quoteAsset"].(string), market.State["memeToken"].(string))
	for _, name := range []string{"storedTotalActiveStock", "effectiveTotalActiveStock", "totalPendingStock"} {
		f.calls[gauge+Hash([]byte(name + "()"))[:10]] = encode("10")
	}
	f.calls[gauge+Hash([]byte("deferredForfeiture()"))[:10]] = encode("20", "30")
	for _, field := range []string{"quoteAsset", "memeToken"} {
		asset := market.State[field].(string)
		f.calls[gauge+Hash([]byte("rewardState(address)"))[:10]+strings.Repeat("0", 24)+asset[2:]] = encode(strings.Repeat("f", 64), "3")
	}
	user := "0x" + strings.Repeat("e", 40)
	f.calls[roots["AllocationManager"]+Hash([]byte("rageQuitSettlementPending(bytes32,address)"))[:10]+id[2:]+addressArgument(user)] = encode("0", "0")
	f.calls[roots["ProtocolFeeVault"]+Hash([]byte("rawRewardExitAt(bytes32,address)"))[:10]+id[2:]+addressArgument(user)] = bytesWord("0")
	f.calls[gauge+Hash([]byte("positionOf(address)"))[:10]+strings.Repeat("0", 24)+user[2:]] = encode("10", "20", "5", "ffff", strings.Repeat("f", 64), "30")
	f.calls[gauge+Hash([]byte("activationSnapshot(uint64)"))[:10]+fmt.Sprintf("%064x", 5)] = encode("aa", "bb", "1", "1")
	log := chainrpc.Log{Address: gauge, BlockHash: b.Hash, BlockNumber: b.Number, Topics: []string{Hash([]byte("PendingScheduled(address,bytes32,uint256,uint64,uint64)")), wordHex(user[2:]), id}, Data: "0x" + hex.EncodeToString(encode("20", "5", "ffff"))}
	f.headers = 0
	return f, b, market, user, log
}

func TestGaugeBlockObservationsBindAndDeduplicate(t *testing.T) {
	f, b, market, user, log := gaugeFixture(t)
	before := f.reads
	batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, []chainrpc.Log{log, log})
	if err != nil {
		t.Fatal(err)
	}
	if batch.Expected != 3 || len(batch.Observations) != 3 {
		t.Fatal(batch)
	}
	if f.reads-before != 20 {
		t.Fatalf("duplicate read: got %d calls", f.reads-before)
	} // core 7, market 2, Gauge 7 + position/snapshot/exit/settlement 4
	state := batch.Observations[1]
	if state.Kind != "gauge" || state.Value["storedTotalActiveStock"] != "16" || state.Value["effectiveTotalActiveStock"] != "16" {
		t.Fatal(state)
	}
	pos := batch.Observations[2]
	if pos.Kind != "gaugePosition" || pos.Key != user+":"+market.MarketID || pos.Value["pendingAmount"] != "32" || pos.Value["activeAmount"] != "16" {
		t.Fatal(pos)
	}
	if pos.Value["quoteClaimable"] != "115792089237316195423570985008687907853269984665640564039457584007913129639935" {
		t.Fatal("claim lost precision")
	}
	if pos.Value["activationSnapshot"].(map[string]any)["processed"] != true {
		t.Fatal("missing activation observation")
	}
}

func TestGaugeObservationsRejectIdentityAndPartialReads(t *testing.T) {
	cases := []string{"runtime", "missing discovery", "marketId", "assetUid", "quoteAssetConfigId", "allocationManager", "protocolFeeVault", "quoteAsset", "memeToken", "position padding", "snapshot bool", "missing rewards", "cross market"}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			f, b, market, user, log := gaugeFixture(t)
			gauge := market.State["gauge"].(string)
			switch name {
			case "runtime":
				f.code[gauge] = []byte{9}
			case "missing discovery":
				market.Contracts = nil
			case "position padding":
				f.calls[gauge+Hash([]byte("positionOf(address)"))[:10]+strings.Repeat("0", 24)+user[2:]][64] = 1
			case "snapshot bool":
				f.calls[gauge+Hash([]byte("activationSnapshot(uint64)"))[:10]+fmt.Sprintf("%064x", 5)][127] = 2
			case "missing rewards":
				delete(f.calls, gauge+Hash([]byte("rewardState(address)"))[:10]+strings.Repeat("0", 24)+market.State["quoteAsset"].(string)[2:])
			case "cross market":
				log.Topics[2] = wordHex("99")
			default:
				for i, field := range gaugeIdentityFields {
					if field.Name == name {
						f.calls[gauge+Hash([]byte("gaugeIdentity()"))[:10]][i*32+31] ^= 1
					}
				}
			}
			batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, []chainrpc.Log{log})
			if err == nil || batch.Scope != "" || len(batch.Observations) > 0 {
				t.Fatalf("accepted %s: %+v %v", name, batch, err)
			}
		})
	}
}

func TestGaugeCreationReadsTotalsWithoutInventingUsers(t *testing.T) {
	f, b, market, _, _ := gaugeFixture(t)
	log := f.observation.Logs[0]
	log.BlockNumber = b.Number
	batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, []chainrpc.Log{log})
	if err != nil || batch.Expected != 2 || len(batch.Observations) != 2 {
		t.Fatal(batch, err)
	}
}

func TestGaugeABIFieldsMatchCompiledManifest(t *testing.T) {
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
	for name, fields := range map[string][]events.Input{"GaugeIdentity": gaugeIdentityFields, "PositionView": gaugePositionFields} {
		actual := []string{}
		for _, field := range fields {
			actual = append(actual, field.Type+" "+field.Name)
		}
		if !reflect.DeepEqual(actual, manifest.CompiledSourceTypes.Structs[name]) {
			t.Fatalf("%s ABI drift: %v", name, actual)
		}
	}
}

func TestGaugeSharedActivationSnapshotReadOnce(t *testing.T) {
	f, b, market, user, log := gaugeFixture(t)
	gauge := market.State["gauge"].(string)
	other := "0x" + strings.Repeat("9", 40)
	key := gauge + Hash([]byte("positionOf(address)"))[:10] + strings.Repeat("0", 24)
	f.calls[key+other[2:]] = append([]byte{}, f.calls[key+user[2:]]...)
	for _, c := range f.manifest.Contracts {
		if c.Module == "AllocationManager" {
			f.calls[c.Address+Hash([]byte("rageQuitSettlementPending(bytes32,address)"))[:10]+market.MarketID[2:]+addressArgument(other)] = append(bytesWord("0"), bytesWord("0")...)
		}
		if c.Module == "ProtocolFeeVault" {
			f.calls[c.Address+Hash([]byte("rawRewardExitAt(bytes32,address)"))[:10]+market.MarketID[2:]+addressArgument(other)] = bytesWord("0")
		}
	}
	otherLog := log
	otherLog.Topics = append([]string{}, log.Topics...)
	otherLog.Topics[1] = wordHex(other[2:])
	before := f.reads
	batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, []chainrpc.Log{log, otherLog})
	if err != nil || batch.Expected != 4 || f.reads-before != 22 {
		t.Fatalf("snapshot dedupe: %+v, reads=%d err=%v", batch, f.reads-before, err)
	}
}
