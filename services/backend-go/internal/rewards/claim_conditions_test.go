package rewards

import (
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
)

func rewardRow(t *testing.T, rows []deployment.StateObservation, key string) map[string]any {
	t.Helper()
	for _, row := range rows {
		if row.Kind == "rewardPosition" && row.Key == key {
			return row.Value
		}
	}
	t.Fatalf("missing reward row %q", key)
	return nil
}

func TestBuildClaimConditions(t *testing.T) {
	q, m := "0x"+strings.Repeat("2", 40), "0x"+strings.Repeat("3", 40)
	u1 := "0x" + strings.Repeat("4", 40)
	creatorQuote := identity(marketID, q, "0", u1, "1")
	creatorMeme := identity(marketID, m, "0", u1, "1")
	stakerQuote := identity(marketID, q, "1", u1, "0")
	stakerMeme := identity(marketID, m, "1", u1, "0")

	assert := func(t *testing.T, rows []deployment.StateObservation, key, status, candidate string) map[string]any {
		v := rewardRow(t, rows, key)
		if v["claimStatus"] != status || v["claimCandidateAmount"] != candidate {
			t.Fatalf("%s: status=%v candidate=%v", key, v["claimStatus"], v["claimCandidateAmount"])
		}
		return v
	}

	t.Run("creator quote ignores raw exit", func(t *testing.T) {
		rows := fixtureObservations()
		for _, r := range rows {
			if r.Kind == "creatorEpoch" {
				r.Value["rawRewardExitAt"] = "0"
				r.Value["rawRewardExitReady"] = false
			}
		}
		got, err := Build(rows, nil)
		if err != nil {
			t.Fatal(err)
		}
		assert(t, got, creatorQuote, "candidate", "10")
		assert(t, got, creatorMeme, "raw_exit_required", "0")
	})

	for _, tc := range []struct {
		name, exit, ts string
		ready          bool
		status         string
	}{
		{"request", "0", "100", false, "raw_exit_required"},
		{"wait", "100", "99", false, "raw_exit_waiting"},
		{"reached", "100", "100", true, "candidate"},
	} {
		t.Run("meme "+tc.name, func(t *testing.T) {
			rows := fixtureObservations()
			for _, r := range rows {
				if r.Kind == "creatorEpoch" || r.Kind == "gaugePosition" {
					r.Value["rawRewardExitAt"] = tc.exit
					r.Value["observedAtTimestamp"] = tc.ts
					r.Value["rawRewardExitReady"] = tc.ready
				}
			}
			got, err := Build(rows, nil)
			if err != nil {
				t.Fatal(err)
			}
			assert(t, got, creatorMeme, tc.status, map[string]string{"candidate": "20", "raw_exit_required": "0", "raw_exit_waiting": "0"}[tc.status])
		})
	}

	for _, tc := range []struct{ name, active, pending, unlock, status string }{
		{"active locked", "1", "0", "101", "position_locked"},
		{"pending locked", "0", "1", "101", "position_locked"},
		{"unlock equality", "1", "0", "100", "candidate"},
		{"no principal future unlock", "0", "0", "101", "candidate"},
	} {
		t.Run("staker "+tc.name, func(t *testing.T) {
			rows := fixtureObservations()
			for _, r := range rows {
				if r.Kind == "gaugePosition" {
					r.Value["activeAmount"] = tc.active
					r.Value["pendingAmount"] = tc.pending
					r.Value["unlockAt"] = tc.unlock
				}
			}
			got, err := Build(rows, nil)
			if err != nil {
				t.Fatal(err)
			}
			candidate := "0"
			if tc.status == "candidate" {
				candidate = "50"
			}
			v := assert(t, got, stakerQuote, tc.status, candidate)
			if v["positionUnlockAt"] != tc.unlock || v["positionLockSatisfied"] != (tc.status != "position_locked") {
				t.Fatalf("lock fields: unlock=%v satisfied=%v", v["positionUnlockAt"], v["positionLockSatisfied"])
			}
		})
	}

	t.Run("zero rewards remain zero", func(t *testing.T) {
		rows := fixtureObservations()
		for _, r := range rows {
			if r.Kind == "gaugePosition" {
				r.Value["quoteClaimable"], r.Value["memeClaimable"] = "0", "0"
			}
		}
		got, err := Build(rows, nil)
		if err != nil {
			t.Fatal(err)
		}
		assert(t, got, stakerQuote, "no_rewards", "0")
		assert(t, got, stakerMeme, "no_rewards", "0")
	})

	t.Run("ragequit and conversion remain independent", func(t *testing.T) {
		rows := fixtureObservations()
		for _, r := range rows {
			if r.Kind == "gaugePosition" {
				r.Value["rageQuitSettlementPending"] = true
				r.Value["activeAmount"] = "1"
			}
		}
		got, err := Build(rows, nil)
		if err != nil {
			t.Fatal(err)
		}
		assert(t, got, stakerQuote, "rage_quit_pending", "0")
		assert(t, got, stakerMeme, "rage_quit_pending", "0")
		rows = fixtureObservations()
		for _, r := range rows {
			if r.Kind == "creatorEpoch" || r.Kind == "gaugePosition" {
				r.Value["rawRewardExitAt"] = "101"
				r.Value["rawRewardExitReady"] = false
				r.Value["observedAtTimestamp"] = "100"
			}
			if r.Kind == "gaugePosition" {
				r.Value["activeAmount"] = "1"
				r.Value["unlockAt"] = "101"
			}
		}
		got, err = Build(rows, nil)
		if err != nil {
			t.Fatal(err)
		}
		v := assert(t, got, stakerMeme, "position_locked", "0")
		if v["conversionCandidateAmount"] != "60" {
			t.Fatalf("conversion candidate=%v", v["conversionCandidateAmount"])
		}
	})

	for _, tc := range []struct {
		name, field string
		value       any
	}{
		{"missing active", "activeAmount", nil},
		{"missing pending", "pendingAmount", nil},
		{"missing unlock", "unlockAt", nil},
		{"overflow unlock", "unlockAt", "18446744073709551616"},
		{"malformed active", "activeAmount", "x"},
		{"malformed pending", "pendingAmount", "x"},
		{"malformed unlock", "unlockAt", "x"},
		{"active without unlock", "unlockAt", "0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows := fixtureObservations()
			for _, r := range rows {
				if r.Kind == "gaugePosition" {
					r.Value[tc.field] = tc.value
					if tc.name == "active without unlock" {
						r.Value["activeAmount"] = "1"
					}
				}
			}
			if _, err := Build(rows, nil); err == nil {
				t.Fatal("accepted malformed lock fields")
			}
		})
	}
}
