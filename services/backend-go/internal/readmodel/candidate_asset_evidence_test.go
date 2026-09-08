package readmodel

import (
	"encoding/json"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestCandidateAssetEvidence(t *testing.T) {
	for _, mode := range []string{"valid", "missing", "stockToken", "userStockVault", "tokenDecimals", "status", "minimumAllocation"} {
		t.Run(mode, func(t *testing.T) {
			values := map[string]any{"stockToken": "token", "userStockVault": "vault", "tokenDecimals": "18", "minimumAllocation": "414"}
			encoded, _ := json.Marshal(map[string]any{"kind": "asset", "id": "id", "status": "1", "values": values})
			asset := map[string]any{"stockToken": "token", "userStockVault": "vault", "tokenDecimals": "18", "minimumAllocation": "414", "status": "1"}
			rows := map[string]json.RawMessage{"asset:id": encoded}
			if mode == "missing" {
				delete(rows, "asset:id")
			} else if mode != "valid" {
				asset[mode] = "changed"
			}
			batch := deployment.ObservationBatch{Observations: []deployment.StateObservation{{Kind: "asset", Key: "id", Value: map[string]any{"asset": asset}}}}
			if e := verifyCandidateConfigEvidence(batch, rows); (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}

func TestCandidateConfigEventEvidence(t *testing.T) {
	for _, kind := range []string{"quote", "baseline", "template"} {
		fields := candidateConfigEventFields[kind]
		modes := []string{"valid", "status", "missing row", "wrong kind", "wrong id"}
		for field := range fields {
			modes = append(modes, field)
		}
		for _, mode := range modes {
			t.Run(kind+"/"+mode, func(t *testing.T) {
				observed := map[string]any{"status": "2"}
				values := map[string]any{}
				for from, to := range fields {
					values[from] = "value-" + from
					observed[to] = "value-" + from
				}
				row := map[string]any{"kind": kind, "id": "id", "status": "2", "values": values}
				switch mode {
				case "status":
					observed["status"] = "1"
				case "wrong kind":
					row["kind"] = "asset"
				case "wrong id":
					row["id"] = "other"
				case "valid", "missing row":
				default:
					observed[fields[mode]] = "altered"
				}
				encoded, _ := json.Marshal(row)
				rows := map[string]json.RawMessage{kind + ":id": encoded}
				if mode == "missing row" {
					delete(rows, kind+":id")
				}
				batch := deployment.ObservationBatch{Observations: []deployment.StateObservation{{Kind: kind, Key: "id", Value: observed}}}
				if e := verifyCandidateConfigEvidence(batch, rows); (e == nil) != (mode == "valid") {
					t.Fatal(mode, e)
				}
			})
		}
	}
}
