package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPublisherPreflight(t *testing.T) {
	t.Setenv("TG_CHAIN_ID", "46630")
	t.Setenv("TG_PUBLISHER_DATABASE_URL", "://invalid")
	t.Setenv("TG_PUBLISH_ACCOUNTS", "")
	t.Setenv("TG_PUBLISH_IDENTITIES", "")
	malformed := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(malformed, []byte(`{"not":"a snapshot"}`), 0600); err != nil {
		t.Fatal(err)
	}
	valid := "../../internal/readmodel/testdata/snapshot.json"
	for _, tc := range []struct {
		name              string
		args              []string
		flag, value, want string
	}{
		{name: "usage", want: "usage:"},
		{name: "timestamp syntax", args: []string{valid, "bad"}, want: "invalid producer verification timestamp"},
		{name: "stale", args: []string{valid, time.Now().Add(-time.Hour).Format(time.RFC3339Nano)}, want: "stale or in the future"},
		{name: "future", args: []string{valid, time.Now().Add(time.Hour).Format(time.RFC3339Nano)}, want: "stale or in the future"},
		{name: "accounts flag", flag: "TG_PUBLISH_ACCOUNTS", value: "TRUE", want: "TG_PUBLISH_ACCOUNTS must"},
		{name: "identity flag", flag: "TG_PUBLISH_IDENTITIES", value: "yes", want: "TG_PUBLISH_IDENTITIES must"},
		{name: "missing file", args: []string{"missing.json", time.Now().Format(time.RFC3339Nano)}, want: "cannot open snapshot file"},
		{name: "invalid snapshot", args: []string{malformed, time.Now().Format(time.RFC3339Nano)}},
		{name: "valid input reaches database config", args: []string{valid, time.Now().Format(time.RFC3339Nano)}, want: "invalid database configuration"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.flag != "" {
				t.Setenv(tc.flag, tc.value)
				tc.args = []string{valid, time.Now().Format(time.RFC3339Nano)}
			}
			var out bytes.Buffer
			err := run(context.Background(), tc.args, &out)
			if err == nil || out.Len() != 0 {
				t.Fatal("failed preflight reported success", err, out.String())
			}
			if tc.want != "" && !strings.Contains(err.Error(), tc.want) {
				t.Fatal(err)
			}
			if tc.name == "invalid snapshot" && strings.Contains(err.Error(), "database") {
				t.Fatal("invalid snapshot reached database", err)
			}
		})
	}
}
func TestPublisherCancelledBeforeWork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var out bytes.Buffer
	if err := run(ctx, nil, &out); !errors.Is(err, context.Canceled) || out.Len() != 0 {
		t.Fatal(err, out.String())
	}
}
