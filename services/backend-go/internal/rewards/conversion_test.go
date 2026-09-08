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
	u := "0x" + strings.Repeat("4", 40)
	for _, tc := range []struct {
		name, phase, exit string
		ready             bool
		pending           bool
		want              string
		candidate         string
	}{
		{"quote not applicable", "1", "0", false, false, "not_applicable", "0"},
		{"meme no rewards", "1", "0", false, false, "no_rewards", "0"},
		{"not graduated", "0", "0", false, false, "not_graduated", "0"},
		{"rage quit pending", "1", "0", false, true, "rage_quit_pending", "0"},
		{"raw exit ready", "1", "100", true, false, "raw_exit_ready", "0"},
		{"candidate", "1", "101", false, false, "candidate", "60"},
		{"candidate without exit", "1", "0", false, false, "candidate", "60"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows := conversionFixture(tc.phase)
			for _, r := range rows {
				if r.Kind == "creatorEpoch" && r.Value["beneficiary"] == u {
					r.Value["rawRewardExitAt"] = tc.exit
					r.Value["rawRewardExitReady"] = tc.ready
				}
				if r.Kind == "gaugePosition" {
					r.Value["rawRewardExitAt"] = tc.exit
					r.Value["rawRewardExitReady"] = tc.ready
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
		if r.Kind == "creatorEpoch" && r.Value["epoch"] == "1" {
			r.Value["rawRewardExitAt"] = "101"
			r.Value["rawRewardExitReady"] = false
		}
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
		if r.Value["beneficiaryEpoch"] == "1" {
			if r.Value["conversionStatus"] != "candidate" || r.Value["conversionCandidateAmount"] != "20" {
				t.Fatal(r)
			}
		} else if r.Value["conversionStatus"] != "raw_exit_ready" || r.Value["conversionCandidateAmount"] != "0" {
			t.Fatal(r)
		}
	}
	if seen != 2 {
		t.Fatal("missing creator epochs")
	}
}
