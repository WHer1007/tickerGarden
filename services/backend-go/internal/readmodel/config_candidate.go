package readmodel

import (
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"tickergarden/backend/internal/deployment"
)

// BuildConfigCandidate maps an observed registry record to the flat API values
// contract. It does not authenticate a batch or authorize snapshot publication.
// Asset configuration mapping does not certify Vault principal or solvency.
func BuildConfigCandidate(batch deployment.ObservationBatch, kind, id string, source SourceBlock) (ConfigReadModel, error) {
	fail := func() (ConfigReadModel, error) {
		return ConfigReadModel{}, errors.New("incomplete or invalid configuration candidate")
	}
	fields, ok := configCandidateFields[kind]
	if !ok {
		return fail()
	}
	n, e := strconv.ParseUint(batch.BlockNumber, 0, 64)
	sn, se := Height(source.BlockNumber)
	if e != nil || batch.BlockNumber != "0x"+strconv.FormatUint(n, 16) || se != nil || sn > n || batch.ChainID != source.ChainID || (sn == n && batch.BlockHash != source.BlockHash) || batch.Expected != len(batch.Observations) || len(batch.Observations) > 100000 {
		return fail()
	}
	seen := map[string]bool{}
	var observed map[string]any
	for _, o := range batch.Observations {
		key := o.Kind + ":" + o.Key
		if seen[key] {
			return fail()
		}
		seen[key] = true
		if o.Kind == kind && o.Key == id {
			observed = o.Value
		}
	}
	if observed == nil {
		return fail()
	}
	assetEnvelope := observed
	if kind == "asset" {
		var ok bool
		observed, ok = assetEnvelope["asset"].(map[string]any)
		if !ok {
			return fail()
		}
	}
	status, ok := observed["status"].(string)
	if !ok || (status != "1" && status != "2" && status != "3") {
		return fail()
	}
	values := map[string]any{}
	for field, typ := range fields {
		v, ok := candidateScalar(observed[field], typ)
		if !ok {
			return fail()
		}
		values[field] = v
	}
	if kind == "asset" {
		amount, _ := raw(values["minimumAllocation"].(string))
		if amount.Cmp(big.NewInt(414)) < 0 || values["tokenDecimals"].(uint64) < 6 || values["tokenDecimals"].(uint64) > 18 {
			return fail()
		}
		zero := "0x" + strings.Repeat("0", 40)
		if values["stockToken"] == zero || values["userStockVault"] == zero || values["stockToken"] == values["userStockVault"] {
			return fail()
		}
		fingerprint, ok := assetEnvelope["fingerprint"].(map[string]any)
		if !ok {
			return fail()
		}
		for field, typ := range map[string]string{"tokenRuntimeCodeHash": "bytes32", "beacon": "address", "beaconRuntimeCodeHash": "bytes32", "implementation": "address", "implementationRuntimeCodeHash": "bytes32"} {
			v, ok := candidateScalar(fingerprint[field], typ)
			if !ok {
				return fail()
			}
			values[field] = v
		}
		v, ok := candidateScalar(assetEnvelope["vaultRuntimeCodeHash"], "bytes32")
		if !ok {
			return fail()
		}
		values["vaultRuntimeCodeHash"] = v
	}
	if kind == "quote" {
		binding, ok := observed["stockQuoteBinding"].(map[string]any)
		if !ok {
			return fail()
		}
		for _, field := range []string{"assetUid", "stockTokenFingerprintHash", "referenceEvidenceHash", "generatorPolicyId"} {
			v, ok := candidateScalar(binding[field], "bytes32")
			if !ok {
				return fail()
			}
			values[field] = v
		}
	}
	st, _ := strconv.ParseUint(status, 10, 8)
	candidate := ConfigReadModel{Kind: kind, ID: id, Status: st, Values: values, Source: source}
	// Validate source, identifiers and the flat scalar contract without silently
	// converting missing fields or unknown observation structures into defaults.
	raw, e := json.Marshal(candidate)
	if e != nil {
		return fail()
	}
	if ValidateResponse("ConfigReadModel", raw) != nil {
		return fail()
	}
	if !candidateHash.MatchString(batch.BlockHash) {
		return fail()
	}
	return candidate, nil
}

var candidateHash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var candidateAddress = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

func candidateScalar(v any, typ string) (any, bool) {
	if typ == "bool" {
		b, ok := v.(bool)
		return b, ok
	}
	s, ok := v.(string)
	if !ok {
		return nil, false
	}
	switch typ {
	case "bytes32":
		return s, candidateHash.MatchString(s)
	case "address":
		return s, candidateAddress.MatchString(s)
	case "uint256":
		n, e := raw(s)
		return s, e == nil && n.String() == s
	case "int24":
		n, e := strconv.ParseInt(s, 10, 24)
		return n, e == nil && strconv.FormatInt(n, 10) == s
	default:
		bits, e := strconv.Atoi(strings.TrimPrefix(typ, "uint"))
		if e != nil {
			return nil, false
		}
		n, e := strconv.ParseUint(s, 10, bits)
		return n, e == nil && strconv.FormatUint(n, 10) == s
	}
}

var configCandidateFields = map[string]map[string]string{
	"asset":    {"stockToken": "address", "userStockVault": "address", "tokenDecimals": "uint8", "minimumAllocation": "uint256"},
	"quote":    {"tickerGardenBaselineId": "bytes32", "quoteAsset": "address", "quoteDecimals": "uint8", "phantomQuote": "uint256", "graduationThreshold": "uint256", "economicsHash": "bytes32", "runtimeCodeHash": "bytes32", "identityCurrent": "bool"},
	"baseline": {"referenceChainId": "uint256", "referenceFactory": "address", "referenceFactoryCodeHash": "bytes32", "launchConfigId": "uint256", "supply": "uint256", "curveFeeBps": "uint256", "poolFee": "uint24", "tickSpacing": "int24", "behaviorVectorRoot": "bytes32"},
	"template": {"memeTokenImplementation": "address", "memeTokenCodeHash": "bytes32", "curveImplementation": "address", "curveCodeHash": "bytes32", "gaugeImplementation": "address", "gaugeCodeHash": "bytes32", "graduatedHook": "address", "hookCodeHash": "bytes32", "graduationExecutor": "address", "graduationExecutorCodeHash": "bytes32", "feePolicyId": "bytes32", "executionSpecId": "bytes32", "templateHash": "bytes32", "componentCodeIdentityCurrent": "bool"},
}
