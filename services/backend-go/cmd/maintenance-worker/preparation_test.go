package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestAtomicPreparationCLIRequiresRequestOwnerTokenAndFees(t *testing.T) {
	base := []string{
		"--prepare-atomic", "--manifest", "manifest.json", "--from", "0xsender",
		"--operation", "sweep", "--market", "0xmarket", "--trigger", "0xtrigger",
		"--owner", "worker", "--token", "token", "--gas-limit", "21000",
		"--max-fee-per-gas", "10", "--priority-fee-per-gas", "1",
	}
	for _, name := range []string{"--manifest", "--from", "--operation", "--market", "--trigger", "--owner", "--token", "--gas-limit", "--max-fee-per-gas", "--priority-fee-per-gas"} {
		t.Run("missing "+name, func(t *testing.T) {
			args := omitFlagValue(base, name)
			var out bytes.Buffer
			if err := run(args, &out); err == nil || err.Error() != "atomic preparation requires request, owner/token and explicit fees; incompatible execution flags" || out.Len() != 0 {
				t.Fatalf("args %v: error = %v, output = %q", args, err, out.String())
			}
		})
	}
}

func TestAtomicPreparationCLIRejectsIncompatibleModes(t *testing.T) {
	base := []string{
		"--prepare-atomic", "--manifest", "manifest.json", "--from", "0xsender",
		"--operation", "sweep", "--market", "0xmarket", "--trigger", "0xtrigger",
		"--owner", "worker", "--token", "token", "--gas-limit", "21000",
		"--max-fee-per-gas", "10", "--priority-fee-per-gas", "1",
	}
	for _, extra := range [][]string{{"--submit"}, {"--lease", "acquire"}, {"--generation", "1"}, {"--discover-work"}} {
		args := append(append([]string(nil), base...), extra...)
		var out bytes.Buffer
		if err := run(args, &out); err == nil || err.Error() != "atomic preparation requires request, owner/token and explicit fees; incompatible execution flags" || out.Len() != 0 {
			t.Fatalf("args %v: error = %v, output = %q", args, err, out.String())
		}
	}
}

func TestDescribeReportsAtomicPreparationWithoutSubmission(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["atomicPreparation"] != true || result["transactionSubmission"] != false {
		t.Fatalf("describe flags = atomicPreparation:%v transactionSubmission:%v", result["atomicPreparation"], result["transactionSubmission"])
	}
}

func omitFlagValue(args []string, name string) []string {
	result := make([]string, 0, len(args)-2)
	for i := 0; i < len(args); i++ {
		if args[i] == name {
			i++
			continue
		}
		result = append(result, args[i])
	}
	return result
}
