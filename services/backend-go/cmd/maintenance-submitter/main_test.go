package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMaintenanceSubmitterDescribeReportsSubmissionWithoutCompletion(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var description map[string]any
	if err := json.Unmarshal(out.Bytes(), &description); err != nil {
		t.Fatal(err)
	}
	if description["service"] != "maintenance-submitter" || description["implemented"] != true || description["durableScheduling"] != true || description["transactionSubmission"] != true || description["executionComplete"] != false {
		t.Fatalf("description = %#v", description)
	}
}

func TestMaintenanceSubmitterRejectsInvalidUsage(t *testing.T) {
	usage := "usage: maintenance-submitter --describe | --once | --run"
	for _, args := range [][]string{nil, {"--once", "extra"}, {"--submit"}, {"--unknown"}} {
		var out bytes.Buffer
		err := run(args, &out)
		if err == nil || err.Error() != usage || out.Len() != 0 {
			t.Fatalf("run(%v): error=%v output=%q", args, err, out.String())
		}
	}
}

func TestMaintenanceSubmitterRequiresDatabase(t *testing.T) {
	t.Setenv("TG_ENV", "test")
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "")
	var out bytes.Buffer
	err := run([]string{"--once"}, &out)
	if err == nil || err.Error() != "TG_MAINTENANCE_DATABASE_URL is required" {
		t.Fatalf("error = %v", err)
	}
}

func TestMaintenanceSubmitterRejectsPollIntervalBeforeManifestOpen(t *testing.T) {
	t.Setenv("TG_ENV", "test")
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "postgres://dummy/maintenance")
	t.Setenv("TG_DEPLOYMENT_MANIFEST", filepath.Join(t.TempDir(), "missing.json"))
	for _, interval := range []string{"not-a-duration", "0s", "61s"} {
		t.Run(interval, func(t *testing.T) {
			t.Setenv("TG_MAINTENANCE_POLL_INTERVAL", interval)
			var out bytes.Buffer
			err := run([]string{"--once"}, &out)
			if err == nil || err.Error() != "maintenance poll interval must be 1s..1m" {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestMaintenanceSubmitterRejectsInvalidManifestBeforeRPCAndDatabase(t *testing.T) {
	t.Setenv("TG_ENV", "test")
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "postgres://dummy/maintenance")
	file := filepath.Join(t.TempDir(), "manifest.json")
	if err := os.WriteFile(file, []byte(`{"invalid":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TG_DEPLOYMENT_MANIFEST", file)
	var out bytes.Buffer
	err := run([]string{"--once"}, &out)
	if err == nil || !strings.Contains(err.Error(), "invalid deployment manifest") {
		t.Fatalf("error = %v", err)
	}
}

func TestMaintenanceSubmitterRejectsInvalidRPCBeforeDatabase(t *testing.T) {
	t.Setenv("TG_ENV", "test")
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "postgres://dummy/maintenance")
	t.Setenv("TG_DEPLOYMENT_MANIFEST", writeSubmitterManifest(t))
	t.Setenv("TG_RPC_URL", "not-an-rpc-url")
	var out bytes.Buffer
	err := run([]string{"--once"}, &out)
	if err == nil || err.Error() != "invalid RPC endpoint" {
		t.Fatalf("error = %v", err)
	}
}

func writeSubmitterManifest(t *testing.T) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "manifest.json")
	data := `{"executionSpecId":"V1-EXEC-11","chainId":46630,"genesisHash":"0x0000000000000000000000000000000000000000000000000000000000000000","contracts":[{"module":"UserStockVault","address":"0x0000000000000000000000000000000000000001","runtimeCodeHash":"0x0000000000000000000000000000000000000000000000000000000000000001"}]}`
	if err := os.WriteFile(file, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	return file
}
