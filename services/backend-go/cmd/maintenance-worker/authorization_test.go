package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

const authorizationRecoveryArgsError = "authorization recovery requires fixed request, intent digest, lease fence and recovery ID"

func TestAuthorizationRecoveryRequiresEveryFixedField(t *testing.T) {
	base := []string{
		"--recover-authorization", "--recovery-id", "recovery-1",
		"--manifest", "manifest.json", "--from", "0xfrom",
		"--market", "0xmarket", "--operation", "sweep", "--trigger", "0xtrigger",
		"--intent-digest", "0xdigest", "--owner", "worker-1", "--token", "0xtoken",
		"--generation", "1",
	}
	for _, field := range []string{"--manifest", "--from", "--market", "--operation", "--trigger", "--intent-digest", "--owner", "--token", "--generation", "--recovery-id"} {
		t.Run(field, func(t *testing.T) {
			args := removeFlagValue(base, field)
			var out bytes.Buffer
			if err := run(args, &out); err == nil || err.Error() != authorizationRecoveryArgsError {
				t.Fatalf("error = %v, want %q", err, authorizationRecoveryArgsError)
			}
			if out.Len() != 0 {
				t.Fatalf("unexpected output %q", out.String())
			}
		})
	}
}

func TestAuthorizationRecoveryRejectsIncompatibleExecutionFlags(t *testing.T) {
	for _, extra := range [][]string{
		{"--sign-with", "/bin/signer"},
		{"--submit"},
		{"--prepare-intent"},
		{"--prepare-atomic"},
	} {
		t.Run(extra[0], func(t *testing.T) {
			args := append([]string{
				"--recover-authorization", "--recovery-id", "recovery-1",
				"--manifest", "manifest.json", "--from", "0xfrom",
				"--market", "0xmarket", "--operation", "sweep", "--trigger", "0xtrigger",
				"--intent-digest", "0xdigest", "--owner", "worker-1", "--token", "0xtoken",
				"--generation", "1",
			}, extra...)
			var out bytes.Buffer
			if err := run(args, &out); err == nil || err.Error() != authorizationRecoveryArgsError {
				t.Fatalf("error = %v, want %q", err, authorizationRecoveryArgsError)
			}
		})
	}
}

func TestDescribeReportsAuthorizationRecoveryWithoutTransactionSubmission(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["authorizationRecovery"] != true || result["transactionSubmission"] != false {
		t.Fatalf("describe flags = authorizationRecovery:%v transactionSubmission:%v", result["authorizationRecovery"], result["transactionSubmission"])
	}
}

func removeFlagValue(args []string, flag string) []string {
	result := make([]string, 0, len(args)-2)
	for i := 0; i < len(args); i++ {
		if args[i] == flag {
			i++
			continue
		}
		result = append(result, args[i])
	}
	return result
}
