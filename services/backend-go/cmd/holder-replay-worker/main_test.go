package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDescribeDoesNotNeedConfiguration(t *testing.T) {
	var out bytes.Buffer
	if err := run(context.Background(), []string{"--describe"}, &out); err != nil || !strings.Contains(out.String(), `"automaticInitialize":false`) || !strings.Contains(out.String(), `"publicationEligible":false`) {
		t.Fatal(err, out.String())
	}
}

func TestInvalidArgumentsAndStrictScope(t *testing.T) {
	for _, args := range [][]string{nil, {"--run"}, {"--audit"}, {"--other", "scope.json"}} {
		if err := run(context.Background(), args, &bytes.Buffer{}); err == nil {
			t.Fatal("accepted", args)
		}
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "scope.json")
	if err := os.WriteFile(path, []byte(`{"unknown":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadScope(path); err == nil {
		t.Fatal("accepted unknown scope field")
	}
	if err := os.WriteFile(path, []byte(`{}`+"\n{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadScope(path); err == nil {
		t.Fatal("accepted trailing object")
	}
}

func TestOversizedScopeRejected(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "scope.json")
	if err := os.WriteFile(path, bytes.Repeat([]byte(" "), (1<<20)+1), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadScope(path); err == nil || err.Error() != "holder replay scope exceeds limit" {
		t.Fatalf("oversized scope accepted or wrong error: %v", err)
	}
}

func TestPauseConfiguration(t *testing.T) {
	for _, tc := range []struct {
		raw string
		ok  bool
	}{{"", true}, {"0", true}, {"60000", true}, {"60001", false}, {"-1", false}, {"x", false}} {
		if _, err := pauseDuration(tc.raw); (err == nil) != tc.ok {
			t.Fatal(tc.raw, err)
		}
	}
}
