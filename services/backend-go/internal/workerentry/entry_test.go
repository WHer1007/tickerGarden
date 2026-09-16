package workerentry

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestWorkersCannotAccidentallyRun(t *testing.T) {
	var out, logs bytes.Buffer
	if code := Run("settlement-worker", "SETTLEMENT_OPERATOR", nil, &out, &logs); code != 1 || out.Len() != 0 {
		t.Fatal("unimplemented worker appeared to run")
	}
	if code := Run("settlement-worker", "SETTLEMENT_OPERATOR", []string{"--describe"}, &out, &logs); code != 0 {
		t.Fatal("describe failed")
	}
	var info struct {
		Implemented           bool
		TransactionSubmission bool
		PlannedPermission     string
	}
	if err := json.Unmarshal(out.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if info.Implemented || info.TransactionSubmission || info.PlannedPermission != "SETTLEMENT_OPERATOR" {
		t.Fatal("incorrect worker boundary")
	}
	if code := Run("indexer", "read", []string{"--describe", "unexpected"}, &out, &logs); code != 2 {
		t.Fatal("unexpected arguments accepted")
	}
}
