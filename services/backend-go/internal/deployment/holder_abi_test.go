package deployment

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"tickergarden/backend/internal/events"
)

func TestHolderFieldsMatchCompiledABI(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/out-v1/IV1Protocol.sol/ITreasuryDistributorV1.json")
	if err != nil {
		t.Fatal(err)
	}
	var artifact struct {
		ABI []struct {
			Name    string `json:"name"`
			Type    string `json:"type"`
			Outputs []struct {
				Components []events.Input `json:"components"`
			} `json:"outputs"`
		} `json:"abi"`
	}
	if err = json.Unmarshal(raw, &artifact); err != nil {
		t.Fatal(err)
	}
	for name, fields := range map[string][]events.Input{"market": treasuryMarketFields, "epoch": treasuryEpochFields} {
		found := false
		for _, entry := range artifact.ABI {
			if entry.Type != "function" || entry.Name != name {
				continue
			}
			found = true
			if len(entry.Outputs) != 1 {
				t.Fatal("unexpected tuple output", name)
			}
			actual := []string{}
			expected := []string{}
			for _, f := range fields {
				actual = append(actual, f.Type+" "+f.Name)
			}
			for _, f := range entry.Outputs[0].Components {
				expected = append(expected, f.Type+" "+f.Name)
			}
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("%s ABI drift: got %v want %v", name, actual, expected)
			}
		}
		if !found {
			t.Fatal("ABI function missing", name)
		}
	}
}
