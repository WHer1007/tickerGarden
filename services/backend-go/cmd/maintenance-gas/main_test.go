package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestRunDescribeDeclaresObservationOnly(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatalf("run --describe: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatalf("decode output: %v", err)
	}
	for key, want := range map[string]any{
		"service":               "maintenance-gas",
		"implemented":           true,
		"transactionSubmission": false,
		"budgetRelease":         false,
		"totalNativeFeeKnown":   false,
	} {
		if got[key] != want {
			t.Errorf("%s = %#v, want %#v", key, got[key], want)
		}
	}
}

func TestRunRejectsInvalidModes(t *testing.T) {
	cases := [][]string{
		{},
		{"--observe", "job", "--history", "job"},
		{"--observe", "job", "--unknown"},
		{"--history", "job", "extra"},
	}
	for _, args := range cases {
		t.Run(strings.Join(args, "_"), func(t *testing.T) {
			if err := run(args, &bytes.Buffer{}); err == nil || err.Error() != "usage: maintenance-gas --describe | --observe JOB | --history JOB [--after SEQUENCE]" {
				t.Fatalf("run(%v) error = %v", args, err)
			}
		})
	}
}

func TestRunRejectsObserveAfterIncludingZero(t *testing.T) {
	for _, value := range []string{"0", "3"} {
		t.Run(value, func(t *testing.T) {
			if err := run([]string{"--observe", "job", "--after", value}, &bytes.Buffer{}); err == nil || err.Error() != "after is only valid with history" {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestRunRequiresMaintenanceDatabase(t *testing.T) {
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "")
	if err := run([]string{"--history", "job"}, &bytes.Buffer{}); err == nil || err.Error() != "TG_MAINTENANCE_DATABASE_URL is required" {
		t.Fatalf("error = %v", err)
	}
}
