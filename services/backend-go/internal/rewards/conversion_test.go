package rewards

import (
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
)

func conversionFixture(phase string) []deployment.StateObservation {
	rows := fixtureObservations()
	for _, r := range rows {
		if r.Kind == "canonicalRoute" {
			r.Value["launchPhase"] = phase
		}
	}
	for _, r := range rows {
		if r.Kind == "gaugePosition" {
			r.Value["rageQuitSettlementPending"] = false
			r.Value["rageQuitSettlementPrincipal"] = "1"
		}
	}
	return rows
}

func TestBuildConversionStatuses(t *testing.T) {
	q, m := "0x"+strings.Repeat("2", 40), "0x"+strings.Repeat("3", 40)
	for _, tc := range []struct {
		name, phase     string
		pending         bool
		want, candidate string
	}{
		{"quote not applicable", "1", false, "not_applicable", "0"},
		{"meme no rewards", "1", false, "no_rewards", "0"},
		{"not graduated", "0", false, "not_graduated", "0"},
		{"rage quit pending", "1", true, "rage_quit_pending", "0"},
		{"unlocked meme candidate", "1", false, "candidate", "60"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows := conversionFixture(tc.phase)
			for _, r := range rows {
				if r.Kind == "gaugePosition" {
					r.Value["rageQuitSettlementPending"] = tc.pending
				}
			}
			if tc.name == "meme no rewards" {
				for _, r := range rows {
					if r.Kind == "gaugePosition" {
						r.Value["memeClaimable"] = "0"
					}
				}
			}
			got, err := Build(rows, nil)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, r := range got {
				target := m
				if tc.name == "quote not applicable" {
					target = q
				}
				if r.Value["feeAsset"] == target && r.Value["beneficiaryType"] == "1" {
					found = true
					if r.Value["conversionStatus"] != tc.want || r.Value["conversionCandidateAmount"] != tc.candidate {
						t.Fatalf("%#v", r.Value)
					}
				}
			}
			if !found {
				t.Fatal("missing target reward")
			}
		})
	}
}

func TestBuildConversionRequiresCanonicalRouteAndStakerState(t *testing.T) {
	rows := conversionFixture("1")
	for i, r := range rows {
		if r.Kind == "canonicalRoute" {
			rows = append(rows[:i], rows[i+1:]...)
			break
		}
	}
	if _, err := Build(rows, nil); err == nil {
		t.Fatal("accepted missing canonical route")
	}
	rows = conversionFixture("1")
	for _, r := range rows {
		if r.Kind == "gaugePosition" {
			delete(r.Value, "rageQuitSettlementPending")
		}
	}
	if _, err := Build(rows, nil); err == nil {
		t.Fatal("accepted missing staker state")
	}
}

func TestCreatorConversionKeepsEpochOwnership(t *testing.T) {
	rows := conversionFixture("1")
	for _, r := range rows {
		if r.Kind == "gaugePosition" {
			r.Value["rageQuitSettlementPending"] = true
		}
	}
	got, err := Build(rows, nil)
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, r := range got {
		if r.Value["beneficiaryType"] != "0" || r.Value["assetKind"] != "meme" {
			continue
		}
		seen++
		want := "20"
		if r.Value["beneficiaryEpoch"] == "2" {
			want = "40"
		}
		if r.Value["conversionStatus"] != "candidate" || r.Value["conversionCandidateAmount"] != want {
			t.Fatal(r)
		}

	}
	if seen != 2 {
		t.Fatal("missing creator epochs")
	}
}
