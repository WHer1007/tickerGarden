package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMaintenanceSignerDescribeIsReadOnly(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["service"] != "maintenance-signer" || result["implemented"] != true || result["signingImplemented"] != true || result["transactionSubmission"] != false {
		t.Fatalf("describe = %v", result)
	}
}

func TestMaintenanceSignerRejectsInvalidArgumentsWithoutOutput(t *testing.T) {
	for _, args := range [][]string{nil, {"--submit"}, {"--describe", "--once"}, {"--unknown"}} {
		var out bytes.Buffer
		if err := run(args, &out); err == nil || out.Len() != 0 {
			t.Fatalf("args %v: error=%v output=%q", args, err, out.String())
		}
	}
}

func TestMaintenanceSignerRequiresConfigForOnce(t *testing.T) {
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "")
	var out bytes.Buffer
	err := run([]string{"--once"}, &out)
	if err == nil || err.Error() != "TG_MAINTENANCE_DATABASE_URL is required" {
		t.Fatalf("error = %v, want database config error", err)
	}
}

func TestMaintenanceSignerRejectsNonAbsoluteSignerPathBeforeDatabase(t *testing.T) {
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "postgresql://db/app")
	t.Setenv("TG_DEPLOYMENT_MANIFEST", writeSignerManifest(t))
	t.Setenv("TG_MAINTENANCE_SIGNER", "signer")
	var out bytes.Buffer
	err := run([]string{"--once"}, &out)
	if err == nil || err.Error() != "TG_MAINTENANCE_SIGNER must be an absolute executable path" {
		t.Fatalf("error = %v, want absolute signer path error", err)
	}
}

func writeSignerManifest(t *testing.T) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "manifest.json")
	data := `{"executionSpecId":"V1-EXEC-11","chainId":46630,"genesisHash":"0x0000000000000000000000000000000000000000000000000000000000000000","contracts":[{"module":"UserStockVault","address":"0x0000000000000000000000000000000000000001","runtimeCodeHash":"0x0000000000000000000000000000000000000000000000000000000000000001"}]}`
	if err := os.WriteFile(file, []byte(strings.TrimSpace(data)), 0o600); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestMaintenanceSignerRejectsUnusableExecutableBeforeDatabase(t *testing.T) {
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "postgresql://db/app")
	t.Setenv("TG_DEPLOYMENT_MANIFEST", writeSignerManifest(t))
	dir := t.TempDir()
	file := filepath.Join(dir, "non-executable")
	if e := os.WriteFile(file, []byte("fixture"), 0600); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{dir, file, filepath.Join(dir, "missing")} {
		t.Setenv("TG_MAINTENANCE_SIGNER", path)
		var out bytes.Buffer
		e := run([]string{"--once"}, &out)
		if e == nil || e.Error() != "TG_MAINTENANCE_SIGNER must reference an executable regular file" || out.Len() != 0 {
			t.Fatal(path, e, out.String())
		}
	}
}
