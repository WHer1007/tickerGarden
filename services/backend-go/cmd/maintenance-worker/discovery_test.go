package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestDiscoverWorkRequiresScopeAndNoExecutionFlags(t *testing.T) {
	valid := []string{"--discover-work", "--manifest", "manifest.json", "--from", "0xsender", "--market", "0xmarket", "--operation", "sweep"}
	cases := []struct {
		name string
		args []string
	}{
		{name: "missing manifest", args: []string{"--discover-work", "--from", "0xsender", "--market", "0xmarket", "--operation", "sweep"}},
		{name: "missing from", args: []string{"--discover-work", "--manifest", "manifest.json", "--market", "0xmarket", "--operation", "sweep"}},
		{name: "missing market", args: []string{"--discover-work", "--manifest", "manifest.json", "--from", "0xsender", "--operation", "sweep"}},
		{name: "missing operation", args: []string{"--discover-work", "--manifest", "manifest.json", "--from", "0xsender", "--market", "0xmarket"}},
	}
	for _, extra := range [][]string{{"--trigger", "value"}, {"--submit"}, {"--prepare-intent"}, {"--lease", "acquire"}, {"--history", "job"}} {
		args := append([]string{}, valid...)
		for _, value := range extra {
			args = append(args, value)
		}
		cases = append(cases, struct {
			name string
			args []string
		}{name: "mixed " + extra[0], args: args})
	}

	const want = "discovery requires manifest, from, market and operation; no trigger or execution flags"
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			if err := run(tc.args, &out); err == nil || err.Error() != want {
				t.Fatalf("error = %v, want %q", err, want)
			}
			if out.Len() != 0 {
				t.Fatalf("unexpected output: %q", out.String())
			}
		})
	}
}

func TestDescribeReportsWorkDiscoveryWithoutTransactionSubmission(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["workDiscovery"] != true || result["transactionSubmission"] != false {
		t.Fatalf("capabilities = %v", result)
	}
}
