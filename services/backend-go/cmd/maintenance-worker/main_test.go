package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestMaintenanceCLIRefusesImplicitExecution(t *testing.T) {
	for _, args := range [][]string{nil, {"--operation", "sweep"}, {"--preview"}, {"--describe", "--preview"}, {"--describe", "extra"}, {"--submit"}} {
		var out bytes.Buffer
		if err := run(args, &out); err == nil || out.Len() != 0 {
			t.Fatal("invalid command produced a result", args, err)
		}
	}
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["stage"] != "submission" || result["simulationImplemented"] != true || result["transactionSubmission"] != false || result["executionComplete"] != false {
		t.Fatal(result)
	}
}
