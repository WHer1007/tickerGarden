package readmodel

import (
	"encoding/json"
	"errors"
	"tickergarden/backend/internal/deployment"
)

// Compare independently stored current observations with registration and update
// events replayed from receipts. A source pointer alone does not bind values.
func verifyCandidateConfigEvidence(batch deployment.ObservationBatch, configs map[string]json.RawMessage) error {
	bad := errors.New("candidate configuration observation and event evidence mismatch")
	for _, o := range batch.Observations {
		fields, supported := candidateConfigEventFields[o.Kind]
		if !supported {
			continue
		}
		var row struct {
			Kind   string         `json:"kind"`
			ID     string         `json:"id"`
			Status string         `json:"status"`
			Values map[string]any `json:"values"`
		}
		if json.Unmarshal(configs[o.Kind+":"+o.Key], &row) != nil || row.Kind != o.Kind || row.ID != o.Key {
			return bad
		}
		observed := o.Value
		if o.Kind == "asset" {
			var ok bool
			observed, ok = o.Value["asset"].(map[string]any)
			if !ok {
				return bad
			}
		}
		if observed["status"] != row.Status {
			return bad
		}
		for eventField, observedField := range fields {
			value, ok := row.Values[eventField].(string)
			if !ok || observed[observedField] != value {
				return bad
			}
		}
		// Minimum changes have a separate event. Compare any replayed minimum;
		// absence is not an independent attestation of the observed getter value.
		if minimum, exists := row.Values["minimumAllocation"]; o.Kind == "asset" && exists && observed["minimumAllocation"] != minimum {
			return bad
		}
	}
	return nil
}

// Only compare fields actually committed in each Added/Registered event.
// Getter-only fields still require independent chain observation validation.
var candidateConfigEventFields = map[string]map[string]string{
	"asset":    {"stockToken": "stockToken", "userStockVault": "userStockVault", "tokenDecimals": "tokenDecimals"},
	"quote":    {"quoteAsset": "quoteAsset", "tickerGardenBaselineId": "tickerGardenBaselineId", "economicsHash": "economicsHash"},
	"baseline": {"behaviorVectorRoot": "behaviorVectorRoot", "factoryCodeHash": "referenceFactoryCodeHash"},
	"template": {"templateHash": "templateHash", "executionSpecId": "executionSpecId"},
}
