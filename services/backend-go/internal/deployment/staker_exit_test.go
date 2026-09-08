package deployment

import (
	"context"
	"math/big"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func stakerExitCall(vault, id, user string) string {
	return vault + Hash([]byte("rawRewardExitAt(bytes32,address)"))[:10] + id[2:] + addressArgument(user)
}

func stakerPosition(batch ObservationBatch, key string) (StateObservation, bool) {
	for _, row := range batch.Observations {
		if row.Kind == "gaugePosition" && row.Key == key {
			return row, true
		}
	}
	return StateObservation{}, false
}

func TestStakerExitObservationTiming(t *testing.T) {
	for _, tc := range []struct {
		name, input, expected string
		ready                 bool
	}{
		{"zero", "0", "0", false},
		{"future", "65", "101", false},
		{"exact block time", "64", "100", true},
		{"past", "63", "99", true},
		{"uint256 max", strings.Repeat("f", 64), new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)).String(), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, b, market, user, log := gaugeFixture(t)
			b.Timestamp = "0x64"
			vault := ""
			for _, c := range f.manifest.Contracts {
				if c.Module == "ProtocolFeeVault" {
					vault = c.Address
				}
			}
			f.calls[stakerExitCall(vault, market.MarketID, user)] = bytesWord(tc.input)
			batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, []chainrpc.Log{log}, GaugeAccount{User: user, MarketID: market.MarketID})
			if err != nil {
				t.Fatal(err)
			}
			row, ok := stakerPosition(batch, user+":"+market.MarketID)
			if !ok || row.Value["rawRewardExitAt"] != tc.expected || row.Value["rawRewardExitReady"] != tc.ready || row.Value["observedAtTimestamp"] != "100" {
				t.Fatalf("unexpected position: %#v", row)
			}
		})
	}
}

func TestStakerExitMissingOrMalformedGetterFailsClosed(t *testing.T) {
	for _, malformed := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing", true: "malformed"}[malformed], func(t *testing.T) {
			f, b, market, user, log := gaugeFixture(t)
			vault := ""
			for _, c := range f.manifest.Contracts {
				if c.Module == "ProtocolFeeVault" {
					vault = c.Address
				}
			}
			key := stakerExitCall(vault, market.MarketID, user)
			if malformed {
				f.calls[key] = []byte{1}
			} else {
				delete(f.calls, key)
			}
			batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, []chainrpc.Log{log}, GaugeAccount{User: user, MarketID: market.MarketID})
			if err == nil || batch.Scope != "" || len(batch.Observations) != 0 {
				t.Fatalf("expected empty failed batch: %#v, %v", batch, err)
			}
		})
	}
}

func TestStakerExitEmptyBlockRefreshesGetter(t *testing.T) {
	f, b, market, user, _ := gaugeFixture(t)
	vault := ""
	for _, c := range f.manifest.Contracts {
		if c.Module == "ProtocolFeeVault" {
			vault = c.Address
		}
	}
	key := stakerExitCall(vault, market.MarketID, user)
	f.calls[key] = bytesWord("64")
	batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, nil, GaugeAccount{User: user, MarketID: market.MarketID})
	if err != nil {
		t.Fatal(err)
	}
	row, ok := stakerPosition(batch, user+":"+market.MarketID)
	if !ok || row.Value["rawRewardExitAt"] != "100" || row.Value["rawRewardExitReady"] != true {
		t.Fatalf("initial refresh failed: %#v", row)
	}
	f.calls[key] = bytesWord("0")
	batch, err = ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, nil, GaugeAccount{User: user, MarketID: market.MarketID})
	if err != nil {
		t.Fatal(err)
	}
	row, ok = stakerPosition(batch, user+":"+market.MarketID)
	if !ok || row.Value["rawRewardExitAt"] != "0" || row.Value["rawRewardExitReady"] != false {
		t.Fatalf("updated refresh failed: %#v", row)
	}
}

func TestStakerExitInvalidTimestampFailsClosed(t *testing.T) {
	f, b, market, user, _ := gaugeFixture(t)
	b.Timestamp = "0xno"
	batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, nil, GaugeAccount{User: user, MarketID: market.MarketID})
	if err == nil || batch.Scope != "" || len(batch.Observations) != 0 {
		t.Fatal("invalid timestamp accepted", batch, err)
	}
}

func TestStakerSettlementGateObservation(t *testing.T) {
	for _, mode := range []string{"pending", "missing", "malformed"} {
		t.Run(mode, func(t *testing.T) {
			f, b, market, user, _ := gaugeFixture(t)
			manager := ""
			for _, c := range f.manifest.Contracts {
				if c.Module == "AllocationManager" {
					manager = c.Address
				}
			}
			key := manager + Hash([]byte("rageQuitSettlementPending(bytes32,address)"))[:10] + market.MarketID[2:] + addressArgument(user)
			switch mode {
			case "pending":
				f.calls[key] = append(bytesWord("1"), bytesWord("2a")...)
			case "missing":
				delete(f.calls, key)
			case "malformed":
				f.calls[key] = append(bytesWord("2"), bytesWord("0")...)
			}
			batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, nil, GaugeAccount{User: user, MarketID: market.MarketID})
			if mode != "pending" {
				if err == nil || len(batch.Observations) != 0 {
					t.Fatal("invalid settlement accepted", batch, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			row, ok := stakerPosition(batch, user+":"+market.MarketID)
			if !ok || row.Value["rageQuitSettlementPending"] != true || row.Value["rageQuitSettlementPrincipal"] != "42" {
				t.Fatal(row)
			}
		})
	}
}
