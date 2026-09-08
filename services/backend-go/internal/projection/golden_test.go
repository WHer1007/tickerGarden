package projection

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sort"
	"testing"

	"tickergarden/backend/internal/events"
)

type goldenCase struct {
	Name     string          `json:"name"`
	Input    Input           `json:"input"`
	Expected json.RawMessage `json:"expected"`
}

func decodeJSON(t *testing.T, data []byte) any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var value any
	if err := dec.Decode(&value); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
	return value
}

func TestProjectionGolden(t *testing.T) {
	data, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []goldenCase
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	if err := dec.Decode(&cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("golden fixture is empty")
	}

	state := New()
	inputs := make([]Input, 0, len(cases))
	for i, tc := range cases {
		inputs = append(inputs, tc.Input)
		decoded, err := events.Decode(tc.Input.Module, tc.Input.Log)
		if err != nil {
			t.Fatalf("case %d (%s): decode input: %v", i, tc.Name, err)
		}
		if _, err := state.Apply(tc.Input); err != nil {
			t.Fatalf("case %d (%s): apply: %v", i, tc.Name, err)
		}
		actualBytes, err := state.Snapshot()
		if err != nil {
			t.Fatalf("case %d (%s): snapshot: %v", i, tc.Name, err)
		}
		actual, expected := decodeJSON(t, actualBytes), decodeJSON(t, tc.Expected)
		if !reflect.DeepEqual(actual, expected) {
			t.Fatalf("case %d (%s), signature %s: snapshot mismatch: %s", i, tc.Name, decoded.Signature, difference(actual, expected, "$"))
		}
	}

	catData, err := os.ReadFile("../events/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Events []struct {
			Signature string `json:"signature"`
		} `json:"events"`
	}
	if err := json.Unmarshal(catData, &catalog); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, tc := range cases {
		decoded, err := events.Decode(tc.Input.Module, tc.Input.Log)
		if err != nil {
			t.Fatalf("coverage decode %s: %v", tc.Name, err)
		}
		seen[decoded.Signature] = true
	}
	catalogSignatures := map[string]bool{}
	for _, event := range catalog.Events {
		catalogSignatures[event.Signature] = true
	}
	if len(catalogSignatures) != 83 {
		t.Fatalf("catalog signature count = %d, want 83", len(catalogSignatures))
	}
	if !reflect.DeepEqual(seen, catalogSignatures) {
		t.Fatalf("fixture signature coverage mismatch: fixture=%d catalog=%d", len(seen), len(catalogSignatures))
	}

	replayed, err := Replay(inputs)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	inc, err := state.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	final, err := replayed.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decodeJSON(t, inc), decodeJSON(t, final)) {
		t.Fatal("replay final snapshot differs from incremental snapshot")
	}
}

func difference(a, b any, path string) string {
	if reflect.DeepEqual(a, b) {
		return ""
	}
	if am, ok := a.(map[string]any); ok {
		if bm, ok := b.(map[string]any); ok {
			keys := map[string]bool{}
			for k := range am {
				keys[k] = true
			}
			for k := range bm {
				keys[k] = true
			}
			ordered := []string{}
			for k := range keys {
				ordered = append(ordered, k)
			}
			sort.Strings(ordered)
			for _, k := range ordered {
				av, aok := am[k]
				bv, bok := bm[k]
				if aok != bok {
					return fmt.Sprintf("%s.%s presence got=%v want=%v", path, k, aok, bok)
				}
				if d := difference(av, bv, path+"."+k); d != "" {
					return d
				}
			}
		}
	}
	return fmt.Sprintf("%s got=%v (%T) want=%v (%T)", path, a, a, b, b)
}
