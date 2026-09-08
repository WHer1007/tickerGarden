package main

import (
	"bytes"
	"testing"
)

func TestRebroadcastModeRejectsIncompleteAndMixedArguments(t *testing.T) {
	cases := [][]string{
		{"--rebroadcast"},
		{"--rebroadcast", "--attempt-id", "attempt"},
		{"--rebroadcast", "--attempt-id", "attempt", "--manifest", "manifest.json"},
		{"--rebroadcast", "--attempt-id", "attempt", "--transaction-hash", "0xhash"},
		{"--rebroadcast", "--attempt-id", "attempt", "--manifest", "manifest.json", "--transaction-hash", "0xhash", "--submit"},
		{"--rebroadcast-attempt", "job", "--attempt-id", "attempt", "--manifest", "manifest.json"},
		{"--rebroadcast-attempt", "job"},
		{"--attempt-id", "attempt"},
	}

	for _, extra := range [][]string{{"--preview"}, {"--owner", "worker"}, {"--lease", "acquire"}, {"--observe-receipt", "job"}} {
		cases = append(cases, append([]string{"--rebroadcast", "--attempt-id", "attempt", "--manifest", "manifest.json", "--transaction-hash", "0xhash"}, extra...))
	}
	for _, args := range cases {
		var out bytes.Buffer
		err := run(args, &out)
		if err == nil || err.Error() != "invalid rebroadcast mode arguments" || out.Len() != 0 {
			t.Errorf("run(%q) = %v, output %q; want argument rejection", args, err, out.String())
		}
	}
}

func TestRebroadcastInspectModeRejectsAnyArgumentBeyondKeyAndAttempt(t *testing.T) {
	for _, extra := range [][]string{{"--manifest", "manifest.json"}, {"--transaction-hash", "0xhash"}, {"--preview"}, {"--owner", "owner"}} {
		args := []string{"--rebroadcast-attempt", "job", "--attempt-id", "attempt"}
		args = append(args, extra...)
		var out bytes.Buffer
		err := run(args, &out)
		if err == nil || err.Error() != "invalid rebroadcast mode arguments" || out.Len() != 0 {
			t.Errorf("run(%q) = %v, output %q; want exact argument rejection", args, err, out.String())
		}
	}
}
