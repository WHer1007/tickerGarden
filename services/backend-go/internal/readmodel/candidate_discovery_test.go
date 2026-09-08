package readmodel

import (
	"encoding/json"
	"os"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

func TestCandidateCreationViewsMatchDiscovery(t *testing.T) {
	for _, mode := range []string{"valid", "missing discovery", "missing view", "extra view", "wrong kind", "wrong key", "wrong state", "wrong source", "event mismatch"} {
		t.Run(mode, func(t *testing.T) {
			raw, e := os.ReadFile("../projection/testdata/golden.json")
			if e != nil {
				t.Fatal(e)
			}
			var cases []struct {
				Name  string
				Input projection.Input
			}
			if json.Unmarshal(raw, &cases) != nil {
				t.Fatal("fixture")
			}
			var input projection.Input
			for _, c := range cases {
				if c.Name == "MarketCreated" {
					input = c.Input
				}
			}
			decoded, e := events.Decode(input.Module, input.Log)
			if e != nil {
				t.Fatal(e)
			}
			id := decoded.Args["marketId"].(string)
			state := map[string]any{}
			view := projection.Row{}
			for k, v := range decoded.Args {
				if k != "marketId" {
					state[k] = v
					view[k] = v
				}
			}
			discovery := deployment.MarketDiscovery{MarketID: id, Source: input.Log, State: state}
			input.Observations = []projection.Observation{{Kind: "market", Key: id, Value: view}}
			switch mode {
			case "missing view":
				input.Observations = nil
			case "extra view":
				input.Observations = append(input.Observations, input.Observations[0])
			case "wrong kind":
				input.Observations[0].Kind = "asset"
			case "wrong key":
				input.Observations[0].Key = "wrong"
			case "wrong state":
				view["curve"] = "wrong"
			case "wrong source":
				discovery.Source.TransactionHash = "wrong"
			case "event mismatch":
				view["curve"] = "wrong"
				state["curve"] = "wrong"
			}
			discoveries := map[string]deployment.MarketDiscovery{id: discovery}
			if mode == "missing discovery" {
				delete(discoveries, id)
			}
			e = verifyCandidateInputViews(input, discoveries)
			if (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}
func TestCandidateUnrelatedViewsRejected(t *testing.T) {
	raw, e := os.ReadFile("../projection/testdata/golden.json")
	if e != nil {
		t.Fatal(e)
	}
	var cases []struct{ Input projection.Input }
	if json.Unmarshal(raw, &cases) != nil {
		t.Fatal("fixture")
	}
	input := cases[0].Input
	if verifyCandidateInputViews(input, nil) == nil {
		t.Fatal("asset supplied views accepted")
	}
	input.Observations = nil
	if e := verifyCandidateInputViews(input, nil); e != nil {
		t.Fatal(e)
	}
}
