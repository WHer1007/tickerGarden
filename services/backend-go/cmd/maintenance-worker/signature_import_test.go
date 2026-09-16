package main

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

const signatureImportArgsError = "signature import requires job, intent digest, transaction hash and original lease fence"

func TestSignatureImportRequiresEveryFixedField(t *testing.T) {
	base := []string{
		"--import-signature", "signature.hex", "--job", "job-1", "--intent-digest", "digest-1",
		"--transaction-hash", "hash-1", "--owner", "worker-1", "--token", "token-1", "--generation", "1",
	}
	for _, field := range []string{"--job", "--intent-digest", "--transaction-hash", "--owner", "--token", "--generation"} {
		t.Run(field, func(t *testing.T) {
			var out bytes.Buffer
			if err := run(removeFlagValue(base, field), &out); err == nil || err.Error() != signatureImportArgsError {
				t.Fatalf("error = %v, want %q", err, signatureImportArgsError)
			}
			if out.Len() != 0 {
				t.Fatalf("unexpected output %q", out.String())
			}
		})
	}
}

func TestSignatureImportTakesPriorityAndRejectsOtherExecutionModes(t *testing.T) {
	base := []string{
		"--import-signature", "signature.hex", "--job", "job-1", "--intent-digest", "digest-1",
		"--transaction-hash", "hash-1", "--owner", "worker-1", "--token", "token-1", "--generation", "1",
	}
	for _, extra := range [][]string{
		{"--sign-with", "/bin/signer"},
		{"--submit"},
		{"--recover-authorization", "--recovery-id", "recovery-1"},
	} {
		t.Run(extra[0], func(t *testing.T) {
			var out bytes.Buffer
			args := append(append([]string{}, base...), extra...)
			if err := run(args, &out); err == nil || err.Error() != signatureImportArgsError {
				t.Fatalf("error = %v, want import argument rejection", err)
			}
		})
	}
}

func TestDescribeReportsSignatureImportWithoutTransactionSubmission(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["signatureImport"] != true || result["transactionSubmission"] != false {
		t.Fatalf("describe flags = signatureImport:%v transactionSubmission:%v", result["signatureImport"], result["transactionSubmission"])
	}
}

func TestRunSignatureImportRejectsOversizedFileBeforeDatabase(t *testing.T) {
	path := writeSignatureImportFile(t, make([]byte, 32773))
	var out bytes.Buffer
	if err := runSignatureImport(&out, path, "job", "digest", "hash", "owner", "token", 1); err == nil || err.Error() != "recovered signature file too large or unreadable" {
		t.Fatalf("error = %v, want oversized-file rejection", err)
	}
}

func TestRunSignatureImportRejectsInvalidHexBeforeDatabase(t *testing.T) {
	for _, value := range []string{"0xnot-hex", "0x", "0x" + strings.Repeat("00", 16385)} {
		path := writeSignatureImportFile(t, []byte(value))
		var out bytes.Buffer
		if err := runSignatureImport(&out, path, "job", "digest", "hash", "owner", "token", 1); err == nil || err.Error() != "invalid recovered signature hex" {
			t.Fatalf("error = %v, want invalid-hex rejection", err)
		}
	}
}

func writeSignatureImportFile(t *testing.T, body []byte) string {
	t.Helper()
	path := t.TempDir() + "/signature.hex"
	if err := os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
