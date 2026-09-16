package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestRunDescribeDocumentsCumulativeMaximumGas(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatalf("run --describe: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatalf("decode description: %v", err)
	}
	if got["transactionSubmission"] != false {
		t.Fatalf("transactionSubmission = %#v, want false", got["transactionSubmission"])
	}
	if got["accounting"] != "cumulative maximum gas commitments" {
		t.Fatalf("accounting = %#v, want cumulative maximum gas commitments", got["accounting"])
	}
}

func TestRunRejectsInvalidModesAndArguments(t *testing.T) {
	cases := [][]string{
		{},
		{"--set"},
		{"--inspect"},
		{"--set", "--inspect", "--manifest", "manifest.json", "--from", "0xoperator"},
		{"--inspect", "--manifest", "manifest.json"},
		{"--inspect", "--manifest", "manifest.json", "--from", "0xoperator", "--maximum-total", "10"},
		{"--set", "--manifest", "manifest.json", "--from", "0xoperator", "--max-transaction", "10", "--maximum-total", "100"},
		{"--inspect", "--manifest", "manifest.json", "--from", "0xoperator", "--request-id", "req"},
		{"--inspect", "--manifest", "manifest.json", "--from", "0xoperator", "--max-transaction", "10", "--maximum-total", "100", "--request-id", "req"},
		{"--inspect", "--manifest", "manifest.json", "--from", "0xoperator", "extra"},
	}
	for _, args := range cases {
		t.Run(strings.Join(args, "/"), func(t *testing.T) {
			if err := run(args, &bytes.Buffer{}); err == nil || err.Error() != "usage: maintenance-budget --describe | --inspect/--set --manifest FILE --from ADDRESS [--max-transaction WEI --maximum-total WEI --request-id HASH]" {
				t.Fatalf("run(%q) error = %v, want usage error", args, err)
			}
		})
	}
}

func TestRunRequiresDedicatedOperatorDSNBeforeDatabaseAccess(t *testing.T) {
	t.Setenv("TG_CHAIN_ID", "46630")
	t.Setenv("TG_MAINTENANCE_OPERATOR_DATABASE_URL", "")
	if err := run([]string{"--inspect", "--manifest", "does-not-exist.json", "--from", "0xoperator"}, &bytes.Buffer{}); err == nil || err.Error() != "TG_MAINTENANCE_OPERATOR_DATABASE_URL is required" {
		t.Fatalf("error = %v, want dedicated operator DSN requirement", err)
	}
}
