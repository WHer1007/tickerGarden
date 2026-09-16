package operations

import (
	"reflect"
	"testing"
	"time"
)

func u64(v uint64) *uint64 { return &v }
func i(v int) *int         { return &v }

func healthyStatus(now time.Time, stages ...Stage) Status {
	progress := now.Add(-time.Minute)
	return Status{
		FinalizedCanonical:  true,
		ObservedAt:          now,
		LastJournalProgress: &progress,
		Stages:              stages,
		PrincipalFailed:     i(0),
		PrincipalMissing:    i(0),
		ReceiptRootMissing:  i(0),
	}
}

func alerts(status Status) []string { return status.Alerts }

func TestEvaluateCaughtUpPipelineIsMonitoringOnly(t *testing.T) {
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	s := healthyStatus(now,
		Stage{Name: "journal", Height: u64(105), Canonical: true},
		Stage{Name: "discovery", Height: u64(100), Canonical: true},
		Stage{Name: "publication", Height: u64(100), Canonical: true},
	)
	got := Evaluate(s, u64(100), 5, time.Hour)
	if got.State != "within_monitoring_thresholds" || got.ProductionReadinessVerified {
		t.Fatalf("got state=%q productionReadinessVerified=%v", got.State, got.ProductionReadinessVerified)
	}
	if len(got.Alerts) != 0 {
		t.Fatalf("unexpected alerts: %v", got.Alerts)
	}
	if got.Stages[0].LagBlocks == nil || *got.Stages[0].LagBlocks != "0" {
		t.Errorf("journal lag = %v, want 0", got.Stages[0].LagBlocks)
	}
}

func TestEvaluateBacklogThresholdIsInclusiveBoundary(t *testing.T) {
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	s := healthyStatus(now, Stage{Name: "discovery", Height: u64(95), Canonical: true})
	got := Evaluate(s, u64(100), 5, time.Hour)
	if got.State != "within_monitoring_thresholds" || len(got.Alerts) != 0 {
		t.Fatalf("boundary should be healthy: state=%q alerts=%v", got.State, got.Alerts)
	}
	if got.Stages[0].LagBlocks == nil || *got.Stages[0].LagBlocks != "5" {
		t.Fatalf("lag = %v, want 5", got.Stages[0].LagBlocks)
	}
	s.Stages[0].Height = u64(94)
	got = Evaluate(s, u64(100), 5, time.Hour)
	if !reflect.DeepEqual(got.Alerts, []string{"discovery_backlog"}) || *got.Stages[0].LagBlocks != "6" {
		t.Fatalf("above threshold: %+v", got)
	}
	if s.Stages[0].BlockNumber != nil || s.Stages[0].LagBlocks != nil {
		t.Fatal("evaluation mutated input stages")
	}
}

func TestEvaluateMissingStagesAndFinalizedDoNotInventLag(t *testing.T) {
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	s := healthyStatus(now,
		Stage{Name: "discovery", Canonical: true},
		Stage{Name: "publication", Height: u64(7), Canonical: true},
	)
	got := Evaluate(s, nil, 0, time.Hour)
	if got.StoredFinalized != nil {
		t.Fatalf("stored finalized = %v, want nil", got.StoredFinalized)
	}
	if got.Stages[0].LagBlocks != nil || got.Stages[1].LagBlocks != nil {
		t.Fatalf("missing finalized/stage must not invent lag: %+v", got.Stages)
	}
	if !reflect.DeepEqual(alerts(got), []string{"finalized_reference_missing", "discovery_missing"}) {
		t.Fatalf("alerts = %v", got.Alerts)
	}
}

func TestEvaluateNoncanonicalAndAheadSignals(t *testing.T) {
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	s := healthyStatus(now,
		Stage{Name: "discovery", Height: u64(101), Canonical: false},
		Stage{Name: "publication", Height: u64(102), Canonical: true},
	)
	got := Evaluate(s, u64(100), 10, time.Hour)
	want := []string{"discovery_noncanonical", "discovery_ahead_of_source", "publication_ahead_of_source"}
	if !reflect.DeepEqual(got.Alerts, want) {
		t.Fatalf("alerts = %v, want %v", got.Alerts, want)
	}
}

func TestEvaluateJournalProgressStaleAndFuture(t *testing.T) {
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	for name, tc := range map[string]struct {
		progress time.Time
		want     string
	}{
		"stale": struct {
			progress time.Time
			want     string
		}{progress: now.Add(-2 * time.Hour), want: "journal_progress_stale"},
		"future": struct {
			progress time.Time
			want     string
		}{progress: now.Add(time.Minute), want: "journal_progress_in_future"},
	} {
		s := healthyStatus(now)
		s.LastJournalProgress = &tc.progress
		got := Evaluate(s, u64(100), 0, time.Hour)
		if !reflect.DeepEqual(got.Alerts, []string{tc.want}) {
			t.Errorf("%s alerts = %v, want %q", name, got.Alerts, tc.want)
		}
	}
}

func TestEvaluatePrincipalFailedAndMissingAlerts(t *testing.T) {
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	s := healthyStatus(now)
	s.PrincipalFailed = i(2)
	s.PrincipalMissing = i(3)
	got := Evaluate(s, u64(100), 0, time.Hour)
	want := []string{"principal_checks_failed", "principal_probes_missing"}
	if !reflect.DeepEqual(got.Alerts, want) {
		t.Fatalf("alerts = %v, want %v", got.Alerts, want)
	}

	s = healthyStatus(now)
	s.PrincipalFailed = nil
	got = Evaluate(s, u64(100), 0, time.Hour)
	if !reflect.DeepEqual(got.Alerts, []string{"principal_report_missing"}) {
		t.Fatalf("missing principal report alerts = %v", got.Alerts)
	}
}

func TestEvaluateFinalizedAnchorMustBeCanonical(t *testing.T) {
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	s := healthyStatus(now)
	s.FinalizedCanonical = false
	got := Evaluate(s, u64(100), 5, time.Hour)
	if !reflect.DeepEqual(got.Alerts, []string{"finalized_reference_noncanonical"}) {
		t.Fatalf("alerts: %v", got.Alerts)
	}
}

func TestReceiptRootCoverageAlerts(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		count *int
		alert string
	}{{nil, "receipt_root_coverage_unknown"}, {i(3), "receipt_root_backfill_pending"}, {i(-1), "receipt_root_coverage_invalid"}, {i(0), ""}} {
		s := healthyStatus(now)
		s.ReceiptRootMissing = tc.count
		got := Evaluate(s, u64(1), 5, time.Hour)
		if tc.alert == "" {
			if len(got.Alerts) != 0 {
				t.Fatal(got.Alerts)
			}
		} else if !reflect.DeepEqual(got.Alerts, []string{tc.alert}) {
			t.Fatal(got.Alerts)
		}
	}
}
