package projection

import (
	"bytes"
	"reflect"
	"testing"
)

func TestChangesReconstructSnapshotTablesAfterEachEvent(t *testing.T) {
	state := New()
	persisted := make(map[string]map[string]any, len(tableNames))
	for _, table := range tableNames {
		persisted[table] = map[string]any{}
	}

	for i, input := range fixtureInputs(t) {
		if status, err := state.Apply(input); err != nil {
			t.Fatalf("fixture %d apply: %v", i, err)
		} else if status != "applied" {
			t.Fatalf("fixture %d status = %q, want applied", i, status)
		}
		changes, err := state.Changes()
		if err != nil {
			t.Fatalf("fixture %d changes: %v", i, err)
		}
		for _, change := range changes {
			persisted[change.Table][change.Key] = decodeJSON(t, change.Value)
		}

		snapshot := decodeJSON(t, snapshot(t, state)).(map[string]any)
		wantTables := snapshot["tables"]
		gotTables := make(map[string]any, len(persisted))
		for table, rows := range persisted {
			gotTables[table] = rows
		}
		if !reflect.DeepEqual(gotTables, wantTables) {
			t.Fatalf("fixture %d reconstructed tables differ from snapshot", i)
		}
	}
}

func TestChangesValueMutationDoesNotMutateState(t *testing.T) {
	state := New()
	if _, err := state.Apply(fixtureInputs(t)[0]); err != nil {
		t.Fatal(err)
	}
	before := snapshot(t, state)
	changes, err := state.Changes()
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) == 0 {
		t.Fatal("expected changes")
	}
	changes[0].Value[0] ^= 0xff
	if !bytes.Equal(before, snapshot(t, state)) {
		t.Fatal("mutating returned serialized value mutated state")
	}
}

func TestChangesExactDuplicateIsEmpty(t *testing.T) {
	state := New()
	input := fixtureInputs(t)[0]
	if _, err := state.Apply(input); err != nil {
		t.Fatal(err)
	}
	if _, err := state.Apply(input); err != nil {
		t.Fatal(err)
	}
	changes, err := state.Changes()
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 0 {
		t.Fatalf("duplicate returned %d changes, want 0", len(changes))
	}
}
