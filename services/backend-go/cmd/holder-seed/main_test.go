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
	if err := run(context.Background(), []string{"--describe"}, &out); err != nil || !strings.Contains(out.String(), `"rootVerifiedReceipts":true`) || !strings.Contains(out.String(), `"publicationEligible":false`) {
		t.Fatal(err, out.String())
	}
}

func TestStrictSeedRequest(t *testing.T) {
	for _, args := range [][]string{nil, {"--initialize"}, {"--other", "request.json"}} {
		if err := run(context.Background(), args, &bytes.Buffer{}); err == nil {
			t.Fatal("accepted", args)
		}
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "request.json")
	for _, raw := range []string{`{"unknown":true}`, `{"seed":{},"blockNumber":"0x0"}`, `{"seed":{},"blockNumber":"1"}`, "{}\n{}"} {
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadRequest(path); err == nil {
			t.Fatal("accepted", raw)
		}
	}
}

func TestOversizedSeedRequestRejected(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "request.json")
	if err := os.WriteFile(path, bytes.Repeat([]byte(" "), (1<<20)+1), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadRequest(path); err == nil || err.Error() != "holder seed request exceeds limit" {
		t.Fatalf("oversized request accepted or wrong error: %v", err)
	}
}
