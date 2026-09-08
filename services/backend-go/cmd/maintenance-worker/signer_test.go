package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestSignerModeRequiresJobDigestOwnerTokenAndGeneration(t *testing.T) {
	base := []string{"--sign-with", "/usr/bin/signer", "--job", "job-1", "--intent-digest", "digest-1", "--owner", "worker-1", "--token", "token-1", "--generation", "1"}
	cases := []struct {
		name string
		drop string
	}{
		{name: "job", drop: "--job"},
		{name: "digest", drop: "--intent-digest"},
		{name: "owner", drop: "--owner"},
		{name: "token", drop: "--token"},
		{name: "generation", drop: "--generation"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			args := make([]string, 0, len(base)-2)
			for i := 0; i < len(base); i++ {
				if base[i] == tc.drop {
					i++
					continue
				}
				args = append(args, base[i])
			}
			var out bytes.Buffer
			err := run(args, &out)
			if err == nil || err.Error() != "signer requires job, intent digest and lease fence only" {
				t.Fatalf("run error = %v, want exact signer argument rejection", err)
			}
		})
	}
}

func TestSignerModeRejectsIncompatibleExecutionModes(t *testing.T) {
	base := []string{"--sign-with", "/usr/bin/signer", "--job", "job-1", "--intent-digest", "digest-1", "--owner", "worker-1", "--token", "token-1", "--generation", "1"}
	for _, mode := range [][]string{{"--submit"}, {"--prepare-intent"}, {"--discover-work"}} {
		t.Run(strings.TrimPrefix(mode[0], "--"), func(t *testing.T) {
			var out bytes.Buffer
			err := run(append(append([]string{}, base...), mode...), &out)
			if err == nil || err.Error() != "signer requires job, intent digest and lease fence only" {
				t.Fatalf("run error = %v, want exact incompatible-mode rejection", err)
			}
		})
	}
}

func TestSignerDescribeDeclaresExternalSignerWithoutSubmission(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["externalSigner"] != true || result["transactionSubmission"] != false {
		t.Fatalf("describe flags = externalSigner:%v transactionSubmission:%v", result["externalSigner"], result["transactionSubmission"])
	}
}

func TestRunSignerRejectsRelativePath(t *testing.T) {
	var out bytes.Buffer
	err := runSigner(&out, "./signer", "job-1", "digest-1", "worker-1", "token-1", 1)
	if err == nil || err.Error() != "signer executable must be an absolute path" {
		t.Fatalf("runSigner error = %v, want exact relative-path rejection", err)
	}
}
