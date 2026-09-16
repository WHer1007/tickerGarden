package treasury

import (
	"bytes"
	"context"
	"testing"
)

func TestLifecycleCalldataMatchesCompiledABI(t *testing.T) {
	for _, g := range goldens(t) {
		if got := lifecycleData("finalize", g.Input.MarketID, g.Input.EpochID, ""); got != g.FinalizeData {
			t.Fatal(g.Name, "finalize ABI mismatch")
		}
		if got := lifecycleData("cancel", g.Input.MarketID, g.Input.EpochID, g.Output.DatasetHash); got != g.CancelData {
			t.Fatal(g.Name, "cancel ABI mismatch")
		}
	}
}
func TestLifecycleCommandRejectsAmbiguousTargets(t *testing.T) {
	for _, args := range [][]string{
		{}, {"--action", "broadcast", "--manifest", "x"},
		{"--manifest", "x", "--market", "m", "--epoch", "4294967296"},
		{"--manifest", "x", "--market", "m", "--epoch", "1", "--sender", "s"},
		{"--action", "cancel", "--manifest", "x", "--market", "m", "--epoch", "1", "--sender", "s"},
		{"--action", "finalize", "--manifest", "x", "--candidate", "c", "--sender", "s", "--market", "m"},
	} {
		var out, err bytes.Buffer
		if code := RunLifecycle(context.Background(), args, &out, &err); code != 2 || out.Len() != 0 {
			t.Fatal(args, code, out.String(), err.String())
		}
	}
	var out, err bytes.Buffer
	if code := RunLifecycle(context.Background(), []string{"--help"}, &out, &err); code != 0 {
		t.Fatal(code)
	}
}
