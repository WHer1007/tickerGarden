package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestMaintenanceCLIRejectsInvalidLeaseArguments(t *testing.T) {
	t.Setenv("TG_MAINTENANCE_DATABASE_URL", "")

	tests := []struct {
		name string
		args []string
	}{
		{name: "lease with preview", args: []string{"--lease", "acquire", "--preview"}},
		{name: "lease with history", args: []string{"--lease", "acquire", "--history", "job"}},
		{name: "acquire with generation", args: []string{"--lease", "acquire", "--generation", "1"}},
		{name: "renew with ttl", args: []string{"--lease", "renew", "--ttl", "30"}},
		{name: "release with ttl", args: []string{"--lease", "release", "--ttl", "30"}},
		{name: "job without lease", args: []string{"--job", "job"}},
		{name: "owner without lease", args: []string{"--owner", "worker"}},
		{name: "token without lease", args: []string{"--token", "token"}},
		{name: "unknown lease mode", args: []string{"--lease", "inspect"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out bytes.Buffer
			expected := "invalid lease mode or arguments"
			if tt.args[0] != "--lease" {
				expected = "lease arguments require --lease"
			}
			if err := run(tt.args, &out); err == nil || err.Error() != expected {
				t.Fatalf("expected argument rejection %q, got %v", expected, err)
			}
			if out.Len() != 0 {
				t.Fatalf("invalid lease arguments produced output: %q", out.String())
			}
		})
	}
}

func TestMaintenanceCLIDescribeIncludesPreparationLeases(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["preparationLeases"] != true || result["transactionSubmission"] != false {
		t.Fatal(result)
	}
}
