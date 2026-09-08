package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/settlement"
)

type fakeExecutionRuntime struct {
	progress []settlement.ExecutionProgress
	calls    int
	closed   int
}

func (f *fakeExecutionRuntime) AdvanceExecution(_ context.Context, _ settlement.WorkScope, _ string, _ settlement.ExecutionPolicy) (settlement.ExecutionProgress, error) {
	if f.calls >= len(f.progress) {
		return settlement.ExecutionProgress{}, context.Canceled
	}
	result := f.progress[f.calls]
	f.calls++
	return result, nil
}

func (f *fakeExecutionRuntime) Close() { f.closed++ }

func TestRunDescribeIsReadOnlyAndExplicit(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := run(context.Background(), []string{"--describe"}, &out, &errOut); code != 0 {
		t.Fatalf("describe exit=%d stderr=%q", code, errOut.String())
	}
	for _, want := range []string{`"explicitJobRequired":true`, `"maySignAndSubmit":true`, `"automaticCandidateSelection":false`, `"nonceReuse":false`} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("describe missing %s: %s", want, out.String())
		}
	}
}

func TestRunRejectsInvalidArgumentsWithoutRuntimeAccess(t *testing.T) {
	for _, args := range [][]string{nil, {"--once"}, {"--unknown", "job.json"}, {"--describe", "job.json"}} {
		var out, errOut bytes.Buffer
		if code := run(context.Background(), args, &out, &errOut); code != 1 {
			t.Errorf("args %v exit=%d stderr=%q", args, code, errOut.String())
		}
	}
}

func TestRunRejectsMalformedJobBeforeSignerRPCOrDatabase(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "job.json")
	if err := os.WriteFile(path, []byte(`{"jobKey":"x","unknown":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if code := run(context.Background(), []string{"--once", path}, &out, &errOut); code != 1 || errOut.String() != "invalid executor job file\n" {
		t.Fatalf("exit=%d stderr=%q", code, errOut.String())
	}
}

func TestRunRequiresExplicitRuntimeEnvironmentAfterValidJob(t *testing.T) {
	t.Setenv("TG_SETTLEMENT_EXECUTION_POLICY", "")
	dir := t.TempDir()
	path := filepath.Join(dir, "job.json")
	valid := `{"jobKey":"0000000000000000000000000000000000000000000000000000000000000001"}`
	if err := os.WriteFile(path, []byte(valid), 0o600); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if code := run(context.Background(), []string{"--once", path}, &out, &errOut); code != 1 || errOut.String() != "invalid settlement execution policy\n" {
		t.Fatalf("exit=%d stderr=%q", code, errOut.String())
	}
}

func TestReadRejectsOversizeAndTrailingJSON(t *testing.T) {
	for _, body := range []string{`{}` + strings.Repeat(" ", 1<<20) + `{"jobKey":"hidden"}`, `{} {}`} {
		p := filepath.Join(t.TempDir(), "job.json")
		if e := os.WriteFile(p, []byte(body), 0600); e != nil {
			t.Fatal(e)
		}
		var value map[string]any
		if read(p, &value) == nil {
			t.Fatal("accepted oversized or trailing document")
		}
	}
}

func TestRunWithDependenciesCompletesDurableProgression(t *testing.T) {
	dir := t.TempDir()
	jobPath := filepath.Join(dir, "job.json")
	policyPath := filepath.Join(dir, "policy.json")
	signerPath := filepath.Join(dir, "signer")
	jobKey := strings.Repeat("1", 64)
	if err := os.WriteFile(jobPath, []byte(`{"chainId":46630,"genesisHash":"0x`+strings.Repeat("2", 64)+`","operator":"0x`+strings.Repeat("3", 40)+`","jobKey":"`+jobKey+`"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(policyPath, []byte(`{"gasLimit":"21000","maxFeePerGas":"2","maxPriorityFeePerGas":"1","maximumGasCost":"42000"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(signerPath, []byte("#!/bin/sh\nexit 1\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	runtime := &fakeExecutionRuntime{progress: []settlement.ExecutionProgress{
		{JobKey: jobKey, State: "waiting_receipt", TransactionHash: "0x" + strings.Repeat("4", 64), ReceiptStatus: "not_observed"},
		{JobKey: jobKey, State: "accounting_verified", TransactionHash: "0x" + strings.Repeat("4", 64), ReceiptStatus: "finalized_success", EvidenceSequence: 7, AccountingVerified: true, ReservationReleased: true},
	}}
	env := map[string]string{
		"TG_SETTLEMENT_EXECUTION_POLICY": policyPath,
		"TG_SETTLEMENT_SIGNER_COMMAND":   signerPath,
		"TG_SETTLEMENT_DATABASE_URL":     "postgres://fixture",
		"TG_RPC_URL":                     "http://rpc.fixture",
	}
	var opened int
	deps := executorDependencies{
		getenv: func(key string) string { return env[key] },
		stat:   os.Stat,
		openRuntime: func(_ context.Context, input executorJob, dsn, rpcURL, signer string) (executionRuntime, error) {
			opened++
			if input.ChainID != 46630 || input.JobKey != jobKey || dsn != env["TG_SETTLEMENT_DATABASE_URL"] || rpcURL != env["TG_RPC_URL"] || signer != signerPath {
				t.Fatal("runtime opened with wrong immutable inputs")
			}
			return runtime, nil
		},
		wait: func(context.Context, time.Duration) bool { return true },
	}
	var out, errOut bytes.Buffer
	if code := runWithDependencies(context.Background(), []string{"--run", jobPath}, &out, &errOut, deps); code != 0 {
		t.Fatalf("exit=%d stderr=%q", code, errOut.String())
	}
	if opened != 1 || runtime.calls != 2 || runtime.closed != 1 || errOut.Len() != 0 {
		t.Fatalf("opened=%d calls=%d closed=%d stderr=%q", opened, runtime.calls, runtime.closed, errOut.String())
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], `"state":"waiting_receipt"`) || !strings.Contains(lines[1], `"state":"accounting_verified"`) || !strings.Contains(lines[1], `"accountingVerified":true`) || !strings.Contains(lines[1], `"reservationReleased":true`) {
		t.Fatalf("unexpected progress output: %s", out.String())
	}
}
