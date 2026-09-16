package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestSignedTransactionModeRejectsMixedArguments(t *testing.T) {
	tests := []struct {
		name string
		args []string
	}{
		{name: "signed with preview", args: []string{"--signed", "key", "--preview"}},
		{name: "attach with preview", args: []string{"--attach-signed", "signed.hex", "--preview"}},
		{name: "attach with ttl", args: []string{"--attach-signed", "signed.hex", "--ttl", "30"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out bytes.Buffer
			err := run(tt.args, &out)
			if err == nil || err.Error() != "invalid signed transaction mode arguments" {
				t.Fatalf("error = %v, want precise signed mode error", err)
			}
			if out.Len() != 0 {
				t.Fatalf("stdout = %q, want empty", out.String())
			}
			if strings.Contains(err.Error(), "TG_MAINTENANCE_DATABASE_URL") {
				t.Fatal("mode validation reached database configuration")
			}
		})
	}
}

func TestIntentDigestRequiresAttachSigned(t *testing.T) {
	var out bytes.Buffer
	err := run([]string{"--intent-digest", "0x1234"}, &out)
	if err == nil || err.Error() != "intent-digest requires attach-signed" {
		t.Fatalf("error = %v, want intent-digest requires attach-signed", err)
	}
	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", out.String())
	}
}

func TestDescribeReportsSignedValidationWithoutSubmission(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["signedTransactionValidation"] != true {
		t.Fatalf("signedTransactionValidation = %v, want true", result["signedTransactionValidation"])
	}
	if result["transactionSubmission"] != false {
		t.Fatalf("transactionSubmission = %v, want false", result["transactionSubmission"])
	}
}
