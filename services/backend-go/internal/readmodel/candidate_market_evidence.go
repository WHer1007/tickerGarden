package readmodel

import (
	"encoding/json"
	"errors"
	"reflect"

	"tickergarden/backend/internal/deployment"
)

// Bind current market observations to the creation record and replayed runtime.
// Internal agreement between a route and market is insufficient if both changed.
func verifyCandidateMarketEvidence(batch deployment.ObservationBatch, discoveries map[string]deployment.MarketDiscovery, replay map[string]json.RawMessage) error {
	bad := errors.New("candidate market observation and creation evidence mismatch")
	for _, o := range batch.Observations {
		if o.Kind != "market" {
			continue
		}
		d, ok := discoveries[o.Key]
		if !ok || d.MarketID != o.Key {
			return bad
		}
		for field, typ := range candidateMarketImmutableFields {
			original, ok := d.State[field]
			if !ok {
				return bad
			}
			if _, valid := candidateScalar(original, typ); !valid {
				return bad
			}
			if !reflect.DeepEqual(o.Value[field], original) {
				return bad
			}
		}
		var row struct {
			MarketID string         `json:"marketId"`
			Values   map[string]any `json:"values"`
		}
		if json.Unmarshal(replay[o.Key], &row) != nil || row.MarketID != o.Key {
			return bad
		}
		for field, typ := range map[string]string{"poolId": "bytes32", "sourceVersion": "uint32", "launchPhase": "uint8"} {
			expected := row.Values[field]
			if _, valid := candidateScalar(expected, typ); !valid || !reflect.DeepEqual(o.Value[field], expected) {
				return bad
			}
		}
	}
	return nil
}

var candidateMarketImmutableFields = map[string]string{
	"assetUid": "bytes32", "tickerGardenBaselineId": "bytes32", "quoteAssetConfigId": "bytes32", "launchTemplateId": "bytes32",
	"feePolicyId": "bytes32", "executionSpecId": "bytes32", "expectedEconomics": "bytes32", "launchConfigId": "uint256",
	"creatorRevenueBeneficiaryAtCreation": "address", "memeToken": "address", "curve": "address", "gauge": "address", "quoteAsset": "address",
	"graduatedHook": "address", "creatorTaxBps": "uint16", "creatorFeesToHolders": "bool", "stakingEnabled": "bool",
}
