package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestDescribeDoesNotRequireCredentials(t *testing.T) {
	var out bytes.Buffer
	if e := run([]string{"--describe"}, func(string) string { t.Fatal("describe read environment"); return "" }, &out); e != nil {
		t.Fatal(e)
	}
	var result map[string]any
	if json.Unmarshal(out.Bytes(), &result) != nil || result["readOnly"] != true || result["publicationEligible"] != false || result["independentEmitterAuthentication"] != false {
		t.Fatal(out.String())
	}
}
func TestInvalidInvocationNeverEmitsCandidate(t *testing.T) {
	for _, args := range [][]string{nil, {"--publish"}, {"--once", "extra"}, {"--once"}} {
		var out bytes.Buffer
		e := run(args, func(string) string { return "" }, &out)
		if e == nil || out.Len() != 0 {
			t.Fatal(args, out.String(), e)
		}
	}
	for _, start := range []string{"-1", "01", "9223372036854775808"} {
		var out bytes.Buffer
		if e := run([]string{"--once"}, func(string) string { return start }, &out); e == nil || !strings.Contains(e.Error(), "START_BLOCK") {
			t.Fatal(start, e)
		}
	}
}
