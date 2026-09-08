package treasury

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestValidRecovery(t *testing.T) {
	id := "0x" + strings.Repeat("a", 64)
	operation := "0x" + strings.Repeat("b", 64)

	tests := []struct {
		name      string
		id        string
		operation string
		reason    string
		expected  int
		want      bool
	}{
		{name: "valid", id: id, operation: operation, reason: "operator approved recovery", expected: 0, want: true},
		{name: "uppercase id is valid", id: "0x" + strings.Repeat("A", 64), operation: operation, reason: "ok", expected: 1, want: true},
		{name: "invalid id prefix", id: "0X" + strings.Repeat("a", 64), operation: operation, reason: "ok", expected: 1},
		{name: "invalid id length", id: "0x" + strings.Repeat("a", 63), operation: operation, reason: "ok", expected: 1},
		{name: "invalid id character", id: "0x" + strings.Repeat("g", 64), operation: operation, reason: "ok", expected: 1},
		{name: "invalid operation length", id: id, operation: "0x" + strings.Repeat("b", 63), reason: "ok", expected: 1},
		{name: "operation must be lowercase", id: id, operation: "0x" + strings.Repeat("B", 64), reason: "ok", expected: 1},
		{name: "empty reason", id: id, operation: operation, reason: "", expected: 1},
		{name: "leading whitespace", id: id, operation: operation, reason: " reason", expected: 1},
		{name: "trailing whitespace", id: id, operation: operation, reason: "reason ", expected: 1},
		{name: "control character", id: id, operation: operation, reason: "reason\nokay", expected: 1},
		{name: "invalid utf8", id: id, operation: operation, reason: string([]byte{0xff}), expected: 1},
		{name: "unicode reason valid", id: id, operation: operation, reason: "恢复操作 ✅", expected: 1, want: true},
		{name: "512 runes valid", id: id, operation: operation, reason: strings.Repeat("界", 512), expected: 1, want: true},
		{name: "513 runes invalid", id: id, operation: operation, reason: strings.Repeat("界", 513), expected: 1},
		{name: "negative expected invalid", id: id, operation: operation, reason: "ok", expected: -1},
		{name: "maximum expected valid", id: id, operation: operation, reason: "ok", expected: 2147483646, want: true},
		{name: "int32 maximum invalid", id: id, operation: operation, reason: "ok", expected: 2147483647},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validRecovery(tt.id, tt.operation, tt.reason, tt.expected); got != tt.want {
				t.Fatalf("validRecovery() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRunJobsInvalidRetryHistoryCombinationFailsBeforeDatabase(t *testing.T) {
	id := "0x" + strings.Repeat("a", 64)
	operation := "0x" + strings.Repeat("b", 64)
	var stdout, stderr bytes.Buffer
	code := RunJobs(context.Background(), []string{
		"--retry", id, "--operation-id", operation, "--reason", "ok", "--expected-recovery", "0",
		"--history", id,
	}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("RunJobs() = %d, want 2; stderr=%q", code, stderr.String())
	}
}

func TestRunJobsRetryRequiresOperatorDSN(t *testing.T) {
	id := "0x" + strings.Repeat("a", 64)
	operation := "0x" + strings.Repeat("b", 64)
	t.Setenv("TG_TREASURY_OPERATOR_DATABASE_URL", "")
	t.Setenv("TG_TREASURY_JOBS_DATABASE_URL", "postgres://jobs.example.invalid/db")
	var stdout, stderr bytes.Buffer
	code := RunJobs(context.Background(), []string{
		"--retry", id, "--operation-id", operation, "--reason", "ok", "--expected-recovery", "0",
	}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("RunJobs() = %d, want 1; stderr=%q", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "TG_TREASURY_OPERATOR_DATABASE_URL is required") {
		t.Fatalf("stderr = %q, want operator DSN error", stderr.String())
	}
}
