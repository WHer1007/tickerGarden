package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestMaintenanceReconcilerRejectsInvalidUsage(t *testing.T) {
	usage := "usage: maintenance-reconciler --describe | --once | --run"
	for _, test := range []struct {
		name string
		args []string
	}{
		{name: "nil", args: nil},
		{name: "extra", args: []string{"--once", "extra"}},
		{name: "unknown", args: []string{"--submit"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			var out bytes.Buffer
			err := run(test.args, &out)
			if err == nil || err.Error() != usage {
				t.Fatalf("run(%v) error = %v, want exact usage error", test.args, err)
			}
			if out.Len() != 0 {
				t.Fatalf("run(%v) wrote output for invalid usage: %q", test.args, out.String())
			}
		})
	}
}

func TestMaintenanceReconcilerDescribe(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var description map[string]any
	if err := json.Unmarshal(out.Bytes(), &description); err != nil {
		t.Fatal(err)
	}
	if description["implemented"] != true || description["durableScheduling"] != true || description["transactionSubmission"] != false {
		t.Fatalf("description = %#v", description)
	}
}

func TestMaintenanceReconcilerRejectsPollIntervalBeforeManifestOpen(t *testing.T) {
	// Keep config and the maintenance DSN deterministic; the nonexistent manifest
	// proves interval validation happens before any manifest open attempt.
	t.Setenv("TG_ENV", "test")
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "postgres://dummy/maintenance")
	t.Setenv("TG_DEPLOYMENT_MANIFEST", "/path/that/does/not/exist")

	for _, interval := range []string{"not-a-duration", "0s", "61s"} {
		t.Run(interval, func(t *testing.T) {
			t.Setenv("TG_MAINTENANCE_POLL_INTERVAL", interval)
			var out bytes.Buffer
			err := run([]string{"--once"}, &out)
			if err == nil || err.Error() != "maintenance poll interval must be 1s..1m" {
				t.Fatalf("interval %q error = %v, want poll interval error", interval, err)
			}
			if strings.Contains(err.Error(), "cannot open TG_DEPLOYMENT_MANIFEST") {
				t.Fatalf("interval %q reached manifest open: %v", interval, err)
			}
		})
	}
}

func TestMaintenanceReconcilerDescribesAutomaticGasWithoutRelease(t *testing.T) {
	var out bytes.Buffer
	if e := run([]string{"--describe"}, &out); e != nil {
		t.Fatal(e)
	}
	var description map[string]any
	if e := json.Unmarshal(out.Bytes(), &description); e != nil {
		t.Fatal(e)
	}
	if description["gasObservation"] != true || description["budgetRelease"] != false || description["transactionSubmission"] != false {
		t.Fatal(description)
	}
}
