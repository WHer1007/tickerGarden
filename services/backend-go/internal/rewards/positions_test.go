package rewards

import (
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
)

var marketID = "0x" + strings.Repeat("0", 63) + "1"

func fixtureObservations() []deployment.StateObservation {
	q, m := "0x"+strings.Repeat("2", 40), "0x"+strings.Repeat("3", 40)
	u1, u2 := "0x"+strings.Repeat("4", 40), "0x"+strings.Repeat("5", 40)
	base := func(v map[string]any) deployment.StateObservation {
		return deployment.StateObservation{Kind: "creatorEpoch", Key: marketID + ":" + v["epoch"].(string), Value: v}
	}
	rows := []deployment.StateObservation{{Kind: "gauge", Key: marketID, Value: map[string]any{"identity": map[string]any{"marketId": marketID, "quoteAsset": q, "memeToken": m}}}}
	for _, x := range []struct{ u, e, qa, ma string }{{u1, "1", "10", "20"}, {u2, "2", "30", "40"}} {
		r := base(map[string]any{"marketId": marketID, "epoch": x.e, "beneficiary": x.u, "quoteAsset": q, "memeAsset": m, "quoteLiability": x.qa, "memeLiability": x.ma, "rawRewardExitAt": "100", "rawRewardExitReady": true, "observedAtTimestamp": "100"})
		r.Key = marketID + ":" + x.e
		rows = append(rows, r)
	}
	rows = append(rows, deployment.StateObservation{Kind: "gaugePosition", Key: u1 + ":" + marketID, Value: map[string]any{"marketId": marketID, "user": u1, "quoteClaimable": "50", "memeClaimable": "60", "rawRewardExitAt": "100", "rawRewardExitReady": true, "observedAtTimestamp": "100"}})
	rows[len(rows)-1].Value["activeAmount"] = "1"
	rows[len(rows)-1].Value["pendingAmount"] = "0"
	rows[len(rows)-1].Value["unlockAt"] = "100"
	rows[len(rows)-1].Value["rageQuitSettlementPending"] = false
	rows[len(rows)-1].Value["rageQuitSettlementPrincipal"] = "0"
	rows = append(rows, deployment.StateObservation{Kind: "canonicalRoute", Key: marketID, Value: map[string]any{"launchPhase": "1"}})
	return rows
}

func TestBuildRewardPositionsSeparatesAssetsEpochsAndSorts(t *testing.T) {
	q, m := "0x"+strings.Repeat("2", 40), "0x"+strings.Repeat("3", 40)
	u1, u2 := "0x"+strings.Repeat("4", 40), "0x"+strings.Repeat("5", 40)
	claims := []ClaimTotal{{MarketID: marketID, FeeAsset: q, Role: "0", User: u1, Epoch: "1", Amount: "7", Count: "1", First: "a"}, {MarketID: marketID, FeeAsset: m, Role: "1", User: u1, Epoch: "0", Amount: "8", Count: "1", First: "b"}}
	got, err := Build(fixtureObservations(), claims)
	if err != nil || len(got) != 6 {
		t.Fatalf("build: %v %#v", err, got)
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].Key > got[i].Key {
			t.Fatal("output not sorted")
		}
	}
	for _, r := range got {
		if r.Value["historyComplete"] != false || r.Value["publicationEligible"] != false {
			t.Fatal(r)
		}
	}
	expected := map[string][2]string{
		identity(marketID, q, "0", u1, "1"): {"10", "7"}, identity(marketID, m, "0", u1, "1"): {"20", "0"},
		identity(marketID, q, "0", u2, "2"): {"30", "0"}, identity(marketID, m, "0", u2, "2"): {"40", "0"},
		identity(marketID, q, "1", u1, "0"): {"50", "0"}, identity(marketID, m, "1", u1, "0"): {"60", "8"},
	}
	for _, r := range got {
		want, ok := expected[r.Key]
		if !ok || r.Value["unpaidAmount"] != want[0] || r.Value["observedClaimedAmount"] != want[1] {
			t.Fatal("incorrect reward amounts", r)
		}
	}
}

func TestBuildRejectsInconsistentClaimsAndReady(t *testing.T) {
	base := fixtureObservations()
	for _, tc := range []struct {
		name   string
		mutate func([]deployment.StateObservation) []ClaimTotal
	}{
		{"duplicate", func(_ []deployment.StateObservation) []ClaimTotal {
			c := ClaimTotal{MarketID: marketID, FeeAsset: "0x" + strings.Repeat("2", 40), Role: "0", User: "0x" + strings.Repeat("4", 40), Epoch: "1", Amount: "1", Count: "1", First: "x"}
			return []ClaimTotal{c, c}
		}},
		{"orphan", func(_ []deployment.StateObservation) []ClaimTotal {
			return []ClaimTotal{{MarketID: marketID, FeeAsset: "0x" + strings.Repeat("2", 40), Role: "0", User: "0x" + strings.Repeat("9", 40), Epoch: "1", Amount: "1", Count: "1", First: "x"}}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Build(base, tc.mutate(base)); err == nil {
				t.Fatal("accepted invalid claims")
			}
		})
	}
	bad := base
	bad[1].Value["rawRewardExitReady"] = false
	if _, err := Build(bad, nil); err == nil {
		t.Fatal("accepted mismatched ready")
	}
}

func TestBuildBoundsAndEmptyInput(t *testing.T) {
	if got, err := Build(nil, nil); err != nil || len(got) != 0 {
		t.Fatal(got, err)
	}
	rows := fixtureObservations()
	rows[1].Value["quoteLiability"] = "340282366920938463463374607431768211456"
	if _, err := Build(rows, nil); err != nil {
		t.Fatal("allowed amount above uint256", err)
	}
	rows[1].Value["quoteLiability"] = strings.Repeat("9", 78)
	if _, err := Build(rows, nil); err == nil {
		t.Fatal("accepted unpaid above uint256")
	}
}

func TestBuildClaimedIsUnboundedAndViewsStayConsistent(t *testing.T) {
	rows := fixtureObservations()
	c := ClaimTotal{MarketID: marketID, FeeAsset: "0x" + strings.Repeat("2", 40), Role: "0", User: "0x" + strings.Repeat("4", 40), Epoch: "1", Amount: strings.Repeat("9", 80), Count: "2", First: "event"}
	got, err := Build(rows, []ClaimTotal{c})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range got {
		if r.Value["observedClaimedAmount"] == c.Amount {
			found = true
		}
	}
	if !found {
		t.Fatal("cumulative amount lost")
	}
	rows[2].Value["observedAtTimestamp"] = "101"
	if _, err = Build(rows, nil); err == nil {
		t.Fatal("mixed block timestamps accepted")
	}
	rows = fixtureObservations()
	rows[2].Key = "bad"
	if _, err = Build(rows, nil); err == nil {
		t.Fatal("wrong epoch key accepted")
	}
	rows = fixtureObservations()
	rows[2].Value["quoteAsset"] = "0x" + strings.Repeat("6", 40)
	if _, err = Build(rows, nil); err == nil {
		t.Fatal("conflicting market assets accepted")
	}
}

func TestVerifySavedPositionsRejectsTampering(t *testing.T) {
	base := fixtureObservations()
	rows, err := Build(base, nil)
	if err != nil {
		t.Fatal(err)
	}
	batch := append(base, rows...)
	if _, err = VerifyPositions(batch); err != nil {
		t.Fatal(err)
	}
	rows[0].Value["unpaidAmount"] = "999"
	if _, err = VerifyPositions(batch); err == nil {
		t.Fatal("tampered unpaid accepted")
	}
	rows, err = Build(base, nil)
	if err != nil {
		t.Fatal(err)
	}
	rows[0].Value["publicationEligible"] = true
	if _, err = VerifyPositions(append(base, rows...)); err == nil {
		t.Fatal("publication claim accepted")
	}
	if _, err = VerifyPositions(base); err == nil {
		t.Fatal("missing reward rows accepted")
	}
}
