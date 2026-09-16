package operations

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMetricsFileReplacement(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "pipeline.prom")
	report := Evaluate(healthyStatus(time.Unix(1800000000, 0),
		Stage{Name: "journal", Height: u64(100), Canonical: true},
		Stage{Name: "discovery", Height: u64(100), Canonical: true},
		Stage{Name: "projection", Height: u64(100), Canonical: true},
		Stage{Name: "publication", Height: u64(100), Canonical: true}), u64(100), 5, time.Hour)
	report.ChainID = 46630
	for _, alerts := range [][]string{nil, {"publication delayed"}} {
		report.Alerts = alerts
		if err := writeMetricsFile(path, report); err != nil {
			t.Fatal(err)
		}
		want, err := Metrics(report)
		if err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatal("replacement differs from complete report", err)
		}
	}
	before, _ := os.ReadFile(path)
	report.ChainID = 0
	if err := writeMetricsFile(path, report); err == nil {
		t.Fatal("invalid report accepted")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("invalid report replaced previous data", err)
	}
	report.ChainID = 46630
	blocked := filepath.Join(dir, "directory.prom")
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeMetricsFile(blocked, report); err == nil {
		t.Fatal("rename onto directory succeeded")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 2 {
		t.Fatal("temporary file leaked", entries, err)
	}
}

func TestMetricsFileCLIFailurePreservesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pipeline.prom")
	if err := os.WriteFile(path, []byte("previous report"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"--once", "--metrics-file", path},
		{"--once", "--metrics-file", "relative.prom"},
		{"--once", "--metrics-file", path + ".tmp"},
		{"--once", "--metrics-file", path, "--prometheus"},
	} {
		var out, errOut bytes.Buffer
		if code := Run(context.Background(), args, func(string) string { return "" }, &out, &errOut); code != 1 || out.Len() != 0 || errOut.Len() == 0 {
			t.Fatal(code, out.String(), errOut.String())
		}
		got, err := os.ReadFile(path)
		if err != nil || string(got) != "previous report" {
			t.Fatal("CLI failure changed previous report", err)
		}
	}
}
