package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestHelpListsSupportedCommandFamiliesWithoutRuntimeDependencies(t *testing.T) {
	for _, args := range [][]string{{"--help"}, {"-h"}} {
		var out bytes.Buffer
		if err := run(args, &out); err != nil {
			t.Fatalf("help failed for %v: %v", args, err)
		}
		text := out.String()
		for _, want := range []string{
			"--request", "--quote", "--reference-check", "--prepare-intent",
			"--sign", "--enqueue", "--work-run", "--submit", "--observe-receipt",
			"--receipt-events", "--receipt-trace", "--receipt-gauge-storage",
			"--receipt-liabilities", "--receipt-creator-storage", "--receipt-accounting",
			"--record-execution-evidence", "--execution-evidence-history",
			"executionImplemented=false", "transactionSubmission=false",
		} {
			if !strings.Contains(text, want) {
				t.Errorf("help for %v missing %q", args, want)
			}
		}
	}
}
