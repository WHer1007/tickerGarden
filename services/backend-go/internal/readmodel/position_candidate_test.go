package readmodel

import (
	"reflect"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func positionCandidateFixture(t *testing.T) (deployment.ObservationBatch, MarketReadModel, string) {
	b, m := candidateFixture(t, false)
	user := "0x" + strings.Repeat("5", 40)
	vault := "0x" + strings.Repeat("6", 40)
	b.Observations = append(b.Observations,
		deployment.StateObservation{Kind: "asset", Key: m.AssetUID, Value: map[string]any{"asset": map[string]any{"userStockVault": vault}}},
		deployment.StateObservation{Kind: "vaultPosition", Key: m.AssetUID + ":" + user, Value: map[string]any{"assetUid": m.AssetUID, "user": user, "vault": vault, "deposited": "900719925474099312345", "allocated": "1000", "freeBalanceOf": "900719925474099311345"}},
		deployment.StateObservation{Kind: "vaultAllocation", Key: m.AssetUID + ":" + user + ":" + m.MarketID, Value: map[string]any{"assetUid": m.AssetUID, "user": user, "marketId": m.MarketID, "vault": vault, "allocation": "1000"}},
		deployment.StateObservation{Kind: "gaugePosition", Key: user + ":" + m.MarketID, Value: map[string]any{"user": user, "marketId": m.MarketID, "gauge": m.Gauge, "activeAmount": "600", "pendingAmount": "400", "pendingGeneration": "120", "unlockAt": "86400", "quoteClaimable": "10", "memeClaimable": "20", "rageQuitSettlementPending": false, "rageQuitSettlementPrincipal": "0", "activationSnapshot": map[string]any{"processed": false, "refs": "1", "quoteAccumulator": "0", "memeAccumulator": "0"}}})
	b.Expected = len(b.Observations)
	return b, m, user
}
func TestPositionCandidateActivationAndPrecision(t *testing.T) {
	for _, processed := range []bool{false, true} {
		b, m, u := positionCandidateFixture(t)
		b.Observations[8].Value["activationSnapshot"].(map[string]any)["processed"] = processed
		if !processed {
			b.Observations[8].Value["activationSnapshot"].(map[string]any)["refs"] = "0"
		}
		got, e := BuildPositionCandidate(b, m.MarketID, u, m.Source, m.Source)
		if e != nil {
			t.Fatal(e)
		}
		if got.Free != "900719925474099311345" || got.Allocated != "1000" || got.Claimable[0].Amount != "10" || got.Claimable[1].Amount != "20" {
			t.Fatal(got)
		}
		if processed {
			if got.Active != "1000" || got.Pending != "0" || got.ActivationAt != nil {
				t.Fatal(got)
			}
		} else if got.Active != "600" || got.Pending != "400" || got.ActivationAt == nil || *got.ActivationAt != "120" {
			t.Fatal(got)
		}
		if b.Observations[8].Value["pendingAmount"] != "400" {
			t.Fatal("input mutated")
		}
	}
}
func TestPositionCandidateRejectsContradictions(t *testing.T) {
	for _, mode := range []string{"principal sum", "free sum", "vault", "user", "pending exit", "exit principal", "missing snapshot", "zero refs", "generation", "missing reward", "overflow unlock", "source", "unknown user"} {
		t.Run(mode, func(t *testing.T) {
			b, m, u := positionCandidateFixture(t)
			source := m.Source
			g := b.Observations[8].Value
			switch mode {
			case "principal sum":
				b.Observations[7].Value["allocation"] = "999"
			case "free sum":
				b.Observations[6].Value["freeBalanceOf"] = "0"
			case "vault":
				b.Observations[7].Value["vault"] = m.Curve
			case "user":
				g["user"] = m.Curve
			case "pending exit":
				g["rageQuitSettlementPending"] = true
			case "exit principal":
				g["rageQuitSettlementPrincipal"] = "1"
			case "zero refs":
				g["activationSnapshot"].(map[string]any)["refs"] = "0"
				g["activationSnapshot"].(map[string]any)["processed"] = true
			case "missing snapshot":
				delete(g, "activationSnapshot")
			case "generation":
				g["pendingGeneration"] = "0"
			case "missing reward":
				delete(g, "quoteClaimable")
			case "overflow unlock":
				g["unlockAt"] = "18446744073709551616"
			case "source":
				source.BlockNumber = "2"
			case "unknown user":
				u = m.Curve
			}
			got, e := BuildPositionCandidate(b, m.MarketID, u, m.Source, source)
			if e == nil || !reflect.DeepEqual(got, UserPositionReadModel{}) {
				t.Fatal("invalid position accepted", got, e)
			}
		})
	}
}

func TestPositionCandidateEmptyMarketRetainsOtherAllocations(t *testing.T) {
	b, m, u := positionCandidateFixture(t)
	b.Observations[7].Value["allocation"] = "0"
	g := b.Observations[8].Value
	g["activeAmount"] = "0"
	g["pendingAmount"] = "0"
	g["pendingGeneration"] = "0"
	g["unlockAt"] = "0"
	delete(g, "activationSnapshot")
	got, e := BuildPositionCandidate(b, m.MarketID, u, m.Source, m.Source)
	if e != nil || got.Allocated != "0" || got.Active != "0" || got.Pending != "0" || got.ActivationAt != nil || got.UnlockAt != nil || got.Free != "900719925474099311345" {
		t.Fatal(got, e)
	}
}
