package projection

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/events"
)

func fixtureInputs(t testing.TB) []Input {
	t.Helper()
	data, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Input Input `json:"input"`
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	out := make([]Input, len(cases))
	for i, c := range cases {
		out[i] = c.Input
	}
	return out
}
func snapshot(t *testing.T, s *State) []byte {
	t.Helper()
	b, err := s.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func TestFailedObservationDoesNotPartiallyCommit(t *testing.T) {
	input := fixtureInputs(t)[0]
	s := New()
	before := snapshot(t, s)
	input.Observations = []Observation{{Kind: "asset", Key: "unknown", Value: Row{"minimumAllocation": "414"}}}
	if _, err := s.Apply(input); err == nil {
		t.Fatal("unknown observation target accepted")
	}
	if !bytes.Equal(before, snapshot(t, s)) {
		t.Fatal("failed observation partially committed event/configuration")
	}
	input.Observations = nil
	if status, err := s.Apply(input); err != nil || status != "applied" {
		t.Fatal("failed event poisoned retry", status, err)
	}
}
func TestIdempotenceBindsCompleteProvenanceAndObservations(t *testing.T) {
	input := fixtureInputs(t)[0]
	s := New()
	if _, err := s.Apply(input); err != nil {
		t.Fatal(err)
	}
	before := snapshot(t, s)
	if status, err := s.Apply(input); err != nil || status != "duplicate" {
		t.Fatal("exact replay not idempotent", status, err)
	}
	for name, mutate := range map[string]func(*Input){
		"changed observation": func(i *Input) {
			i.Observations = []Observation{{Kind: "asset", Key: "unknown", Value: Row{"minimumAllocation": "999"}}}
		},
		"changed height":            func(i *Input) { i.Log.BlockNumber = "0xb" },
		"changed transaction index": func(i *Input) { i.Log.TransactionIndex = "0x1" },
		"changed block hash":        func(i *Input) { i.Log.BlockHash = "0x1111111111111111111111111111111111111111111111111111111111111111" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := input
			mutate(&candidate)
			if _, err := s.Apply(candidate); err == nil {
				t.Fatal("conflicting duplicate accepted")
			}
			if !bytes.Equal(before, snapshot(t, s)) {
				t.Fatal("conflict mutated projection")
			}
		})
	}
	// The caller cannot mutate stored nested observations after a successful append.
	input.Observations[0].Value["minimumAllocation"] = "999"
	if !bytes.Equal(before, snapshot(t, s)) {
		t.Fatal("caller mutated stored observation")
	}
}
func TestRejectOrderingAndMixedChain(t *testing.T) {
	inputs := fixtureInputs(t)
	s := New()
	if _, err := s.Apply(inputs[1]); err != nil {
		t.Fatal(err)
	}
	before := snapshot(t, s)
	if _, err := s.Apply(inputs[0]); err == nil {
		t.Fatal("out-of-order log accepted")
	}
	wrong := inputs[2]
	wrong.ChainID = 4663
	if _, err := s.Apply(wrong); err == nil {
		t.Fatal("mixed chain accepted")
	}
	wrong = inputs[2]
	wrong.Log.BlockHash = "0x1111111111111111111111111111111111111111111111111111111111111111"
	if _, err := s.Apply(wrong); err == nil {
		t.Fatal("same-height fork accepted without rebuild")
	}
	if !bytes.Equal(before, snapshot(t, s)) {
		t.Fatal("ordering error mutated projection")
	}
}
func TestMissingSwapAndUnknownCurveFailAtomically(t *testing.T) {
	checked := map[string]bool{}
	for _, input := range fixtureInputs(t) {
		decoded, err := events.Decode(input.Module, input.Log)
		if err != nil {
			t.Fatal(err)
		}
		name := strings.SplitN(decoded.Signature, "(", 2)[0]
		if name != "V4FeeAccrued" && name != "CurveBuy" {
			continue
		}
		s := New()
		if _, err := s.Apply(input); err == nil {
			t.Fatal("accepted missing semantic prerequisite", name)
		}
		if !bytes.Equal(snapshot(t, New()), snapshot(t, s)) {
			t.Fatal("semantic error mutated state", name)
		}
		checked[name] = true
	}
	if len(checked) != 2 {
		t.Fatal("semantic failure cases absent")
	}
}
