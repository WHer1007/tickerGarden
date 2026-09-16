package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestSubmissionModeRejectsMixedArguments(t *testing.T) {
	for _, extra := range [][]string{
		{"--preview"},
		{"--attach-signed", "signed.hex"},
		{"--lease", "acquire"},
		{"--history", "job"},
		{"--gas-limit", "1"},
	} {
		args := append([]string{"--submit", "--manifest", "manifest.json", "--transaction-hash", "0xabc", "--owner", "worker", "--token", "token", "--generation", "1"}, extra...)
		var out bytes.Buffer
		err := run(args, &out)
		if err == nil || err.Error() != "invalid submission mode arguments" {
			t.Fatalf("args %v: error = %v, want precise submission mode error", args, err)
		}
		if out.Len() != 0 {
			t.Fatalf("args %v: stdout = %q, want empty", args, out.String())
		}
	}
}

func TestSubmissionModeRequiresManifestHashAndFence(t *testing.T) {
	base := []string{"--submit", "--manifest", "manifest.json", "--transaction-hash", "0xabc", "--owner", "worker", "--token", "token", "--generation", "1"}
	for _, tc := range []struct {
		name string
		omit string
	}{
		{name: "manifest", omit: "--manifest"},
		{name: "transaction hash", omit: "--transaction-hash"},
		{name: "fence", omit: "--generation"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			args := make([]string, 0, len(base)-2)
			for i := 0; i < len(base); i++ {
				if base[i] == tc.omit {
					i++
					continue
				}
				args = append(args, base[i])
			}
			var out bytes.Buffer
			err := run(args, &out)
			if err == nil || err.Error() != "invalid submission mode arguments" {
				t.Fatalf("error = %v, want precise submission mode error", err)
			}
		})
	}
}

func TestSubmissionReadRejectsExtraArgumentsAndTransactionHashAlone(t *testing.T) {
	for _, args := range [][]string{
		{"--submission", "key", "--preview"},
		{"--submission", "key", "--owner", "worker"},
		{"--transaction-hash", "0xabc"},
	} {
		var out bytes.Buffer
		err := run(args, &out)
		if err == nil || err.Error() != "invalid submission mode arguments" {
			t.Fatalf("args %v: error = %v, want precise submission mode error", args, err)
		}
	}
}

func TestDescribeReportsSubmissionImplementedButIncomplete(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["submissionImplemented"] != true || result["executionComplete"] != false {
		t.Fatalf("submissionImplemented = %v, executionComplete = %v", result["submissionImplemented"], result["executionComplete"])
	}
}
