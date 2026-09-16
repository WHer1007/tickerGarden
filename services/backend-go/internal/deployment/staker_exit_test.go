package deployment

import (
	"context"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

func stakerPosition(batch ObservationBatch, key string) (StateObservation, bool) {
	for _, row := range batch.Observations {
		if row.Kind == "gaugePosition" && row.Key == key {
			return row, true
		}
	}
	return StateObservation{}, false
}

func TestStakerPositionWithoutRawExitGetter(t *testing.T) {
	f, b, market, user, log := gaugeFixture(t)
	for key := range f.calls {
		if strings.Contains(key, Hash([]byte("rawRewardExitAt(bytes32,address)"))[:10]) {
			delete(f.calls, key)
		}
	}
	batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, map[string]MarketDiscovery{market.MarketID: market}, []chainrpc.Log{log}, GaugeAccount{User: user, MarketID: market.MarketID})
	if err != nil {
		t.Fatal(err)
	}
	row, ok := stakerPosition(batch, user+":"+market.MarketID)
	if !ok || row.Value["unlockAt"] != "65535" || row.Value["rageQuitSettlementPending"] != false {
		t.Fatal("missing current gates", row)
	}
	for _, field := range []string{"rawRewardExitAt", "rawRewardExitReady"} {
		if _, ok := row.Value[field]; ok {
			t.Fatal("retired field", field)
		}
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
