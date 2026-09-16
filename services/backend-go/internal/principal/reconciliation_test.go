package principal

import (
	"reflect"
	"testing"

	"tickergarden/backend/internal/deployment"
)

func reconciliationLedger(t *testing.T) *Ledger {
	t.Helper()
	l := New()
	if err := l.Apply(ev("StockDeposited", testAsset, "", "100")); err != nil {
		t.Fatal(err)
	}
	lock := ev("AllocationLocked", testAsset, testMarket, "40")
	lock.Args["userMarketAllocation"] = "40"
	lock.Args["userTotalAllocated"] = "40"
	if err := l.Apply(lock); err != nil {
		t.Fatal(err)
	}
	return l
}

func TestReconcilePlansLedgerIndependentlyWithMixedResults(t *testing.T) {
	l := reconciliationLedger(t)
	views := []deployment.StateObservation{
		{Kind: "vaultPosition", Key: testAsset + ":" + testUser, Value: map[string]any{"deposited": "100", "allocated": "41", "freeBalanceOf": "60"}},
		{Kind: "vaultAllocation", Key: testAsset + ":" + testUser + ":" + testMarket, Value: map[string]any{"allocation": "39"}},
		{Kind: "unrelated", Key: "extra", Value: map[string]any{"deposited": "999"}},
	}
	r := l.Reconcile(views)
	if r.Expected != 8 || r.Completed != 4 || r.Failed != 2 || r.Missing != 4 {
		t.Fatalf("counts: %+v", r)
	}
	want := []Probe{
		{Kind: "vaultPosition", Key: testAsset + ":" + testUser, Field: "deposited", Expected: "100", Actual: strptr("100"), Status: "matched", Comparison: "equal"},
		{Kind: "vaultPosition", Key: testAsset + ":" + testUser, Field: "allocated", Expected: "40", Actual: strptr("41"), Status: "mismatch", Comparison: "equal"},
		{Kind: "vaultPosition", Key: testAsset + ":" + testUser, Field: "freeBalanceOf", Expected: "60", Actual: strptr("60"), Status: "matched", Comparison: "equal"},
		{Kind: "vaultAllocation", Key: testAsset + ":" + testUser + ":" + testMarket, Field: "allocation", Expected: "40", Actual: strptr("39"), Status: "mismatch", Comparison: "equal"},
	}
	if !reflect.DeepEqual(r.Probes[:4], want) {
		t.Fatalf("probes: %#v", r.Probes)
	}
	if r.HistoryComplete || r.PublicationEligible {
		t.Fatal("getter matches must not establish history or publication eligibility")
	}
}

func TestReconcileExcludesDuplicateAndMalformedViews(t *testing.T) {
	l := reconciliationLedger(t)
	key := testAsset + ":" + testUser
	r := l.Reconcile([]deployment.StateObservation{
		{Kind: "vaultPosition", Key: key, Value: map[string]any{"deposited": "100", "allocated": "40", "freeBalanceOf": "60"}},
		{Kind: "vaultPosition", Key: key, Value: map[string]any{"deposited": "100", "allocated": "40", "freeBalanceOf": "60"}},
		{Kind: "vaultAllocation", Key: key + ":" + testMarket, Value: map[string]any{"allocation": "not-a-uint256"}},
	})
	if r.Expected != 8 || r.Completed != 0 || r.Failed != 0 || r.Missing != 8 {
		t.Fatalf("counts: %+v", r)
	}
	for _, p := range r.Probes {
		if p.Actual != nil || p.Status != "missing" {
			t.Fatalf("invalid probe completion: %+v", p)
		}
	}
}

func TestReconcileEmptyLedgerIsIncomplete(t *testing.T) {
	r := New().Reconcile(nil)
	if r.Expected != 0 || r.Completed != 0 || r.Failed != 0 || r.Missing != 0 || r.HistoryComplete || r.PublicationEligible || len(r.Probes) != 0 {
		t.Fatalf("empty reconciliation: %+v", r)
	}
}

func TestReconcileProbeOrderingIsDeterministic(t *testing.T) {
	l := reconciliationLedger(t)
	key := testAsset + ":" + testUser
	views := []deployment.StateObservation{
		{Kind: "vaultAllocation", Key: key + ":" + testMarket, Value: map[string]any{"allocation": "40"}},
		{Kind: "vaultPosition", Key: key, Value: map[string]any{"freeBalanceOf": "60", "allocated": "40", "deposited": "100"}},
	}
	a, b := l.Reconcile(views), l.Reconcile([]deployment.StateObservation{views[1], views[0]})
	if !reflect.DeepEqual(a.Probes, b.Probes) {
		t.Fatalf("probe ordering changed: %#v vs %#v", a.Probes, b.Probes)
	}
}

func strptr(s string) *string { return &s }

func TestReconcilePartialGetterCoverageAndUint256Boundary(t *testing.T) {
	l := reconciliationLedger(t)
	key := testAsset + ":" + testUser
	r := l.Reconcile([]deployment.StateObservation{
		{Kind: "vaultPosition", Key: key, Value: map[string]any{"deposited": "100", "allocated": "39"}},
	})
	if r.Expected != 8 || r.Completed != 2 || r.Failed != 1 || r.Missing != 6 || r.Probes[2].Actual != nil || r.Probes[3].Actual != nil {
		t.Fatalf("partial coverage lost planned fields: %+v", r)
	}
	for _, actual := range []string{"01", "-1", "115792089237316195423570985008687907853269984665640564039457584007913129639936"} {
		r = l.Reconcile([]deployment.StateObservation{{Kind: "vaultPosition", Key: key, Value: map[string]any{"deposited": actual}}})
		if r.Completed != 0 || r.Missing != 8 {
			t.Fatalf("invalid uint256 counted complete: %+v", r)
		}
	}
	r = l.Reconcile([]deployment.StateObservation{
		{Kind: "vaultPosition", Key: key, Value: map[string]any{"deposited": "100", "allocated": "40", "freeBalanceOf": "60"}},
		{Kind: "vaultAllocation", Key: key + ":" + testMarket, Value: map[string]any{"allocation": "40"}},
		{Kind: "vaultSolvency", Key: testAsset, Value: map[string]any{"totalDeposited": "100", "totalAllocated": "40", "tokenBalance": "100"}},
		{Kind: "vaultMarket", Key: testAsset + ":" + testMarket, Value: map[string]any{"marketAllocated": "40"}},
	})
	if r.Completed != 8 || r.Failed != 0 || r.Missing != 0 || r.HistoryComplete || r.PublicationEligible {
		t.Fatalf("matched probes must retain coverage gate: %+v", r)
	}
}

func TestReconcileAssetSolvencyUsesNumericLowerBound(t *testing.T) {
	l := reconciliationLedger(t)
	for _, tt := range []struct {
		balance, status string
		failed          int
	}{{"9", "mismatch", 1}, {"100", "matched", 0}, {"1000", "matched", 0}} {
		r := l.Reconcile([]deployment.StateObservation{{Kind: "vaultSolvency", Key: testAsset, Value: map[string]any{"totalDeposited": "100", "totalAllocated": "40", "tokenBalance": tt.balance}}})
		if r.Expected != 8 || r.Completed != 3 || r.Missing != 5 || r.Failed != tt.failed {
			t.Fatalf("balance %s: %+v", tt.balance, r)
		}
		want := []Probe{
			{Kind: "vaultSolvency", Key: testAsset, Field: "totalDeposited", Expected: "100", Actual: strptr("100"), Status: "matched", Comparison: "equal"},
			{Kind: "vaultSolvency", Key: testAsset, Field: "totalAllocated", Expected: "40", Actual: strptr("40"), Status: "matched", Comparison: "equal"},
			{Kind: "vaultSolvency", Key: testAsset, Field: "tokenBalance", Expected: "100", Actual: strptr(tt.balance), Status: tt.status, Comparison: "atLeast"},
		}
		if !reflect.DeepEqual(r.Probes[4:7], want) {
			t.Fatalf("asset probes: %+v", r.Probes[4:7])
		}
	}
}
