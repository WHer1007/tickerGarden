package readmodel

import (
	"encoding/json"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestCandidateMarketEvidence(t *testing.T) {
	modes := []string{"valid", "graduated", "missing discovery", "missing replay", "wrong replay id", "poolId", "sourceVersion", "launchPhase"}
	for field := range candidateMarketImmutableFields {
		modes = append(modes, field)
	}
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			state := map[string]any{}
			for field, typ := range candidateMarketImmutableFields {
				var v any = "1"
				switch typ {
				case "bytes32":
					v = "0x" + strings.Repeat("1", 64)
				case "address":
					v = "0x" + strings.Repeat("2", 40)
				case "bool":
					v = true
				}
				state[field] = v
			}
			observed := map[string]any{}
			for k, v := range state {
				observed[k] = v
			}
			runtime := map[string]any{"poolId": "0x" + strings.Repeat("0", 64), "sourceVersion": "1", "launchPhase": "0"}
			if mode == "graduated" {
				runtime["poolId"] = "0x" + strings.Repeat("3", 64)
				runtime["sourceVersion"] = "2"
				runtime["launchPhase"] = "1"
			}
			for k, v := range runtime {
				observed[k] = v
			}
			rowID := "id"
			if mode == "wrong replay id" {
				rowID = "other"
			}
			encoded, _ := json.Marshal(map[string]any{"marketId": rowID, "values": runtime})
			replay := map[string]json.RawMessage{"id": encoded}
			discoveries := map[string]deployment.MarketDiscovery{"id": {MarketID: "id", State: state}}
			switch mode {
			case "missing discovery":
				delete(discoveries, "id")
			case "missing replay":
				delete(replay, "id")
			case "valid", "graduated", "wrong replay id":
			default:
				observed[mode] = "changed"
			}
			batch := deployment.ObservationBatch{Observations: []deployment.StateObservation{{Kind: "market", Key: "id", Value: observed}}}
			if e := verifyCandidateMarketEvidence(batch, discoveries, replay); (e == nil) != (mode == "valid" || mode == "graduated") {
				t.Fatal(mode, e)
			}
		})
	}
}
