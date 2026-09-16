package deployment

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
	"time"
)

const ConfigObservationScope = "market-curve-gauge-vault-fees-holder-config-v1"
const MaxConfigReads = 1024

// ConfigTarget is sourced by the worker from canonical configuration event rows.
type ConfigTarget struct{ Kind, ID string }

var quoteConfigFields = []events.Input{{Name: "tickerGardenBaselineId", Type: "bytes32"}, {Name: "quoteAsset", Type: "address"}, {Name: "quoteDecimals", Type: "uint8"}, {Name: "phantomQuote", Type: "uint256"}, {Name: "graduationThreshold", Type: "uint256"}, {Name: "economicsHash", Type: "bytes32"}, {Name: "status", Type: "uint8"}}
var baselineConfigFields = []events.Input{{Name: "referenceChainId", Type: "uint256"}, {Name: "referenceFactory", Type: "address"}, {Name: "referenceFactoryCodeHash", Type: "bytes32"}, {Name: "launchConfigId", Type: "uint256"}, {Name: "supply", Type: "uint256"}, {Name: "curveFeeBps", Type: "uint256"}, {Name: "poolFee", Type: "uint24"}, {Name: "tickSpacing", Type: "int24"}, {Name: "behaviorVectorRoot", Type: "bytes32"}, {Name: "status", Type: "uint8"}}
var templateConfigFields = []events.Input{{Name: "memeTokenImplementation", Type: "address"}, {Name: "memeTokenCodeHash", Type: "bytes32"}, {Name: "curveImplementation", Type: "address"}, {Name: "curveCodeHash", Type: "bytes32"}, {Name: "gaugeImplementation", Type: "address"}, {Name: "gaugeCodeHash", Type: "bytes32"}, {Name: "graduatedHook", Type: "address"}, {Name: "hookCodeHash", Type: "bytes32"}, {Name: "graduationExecutor", Type: "address"}, {Name: "graduationExecutorCodeHash", Type: "bytes32"}, {Name: "feePolicyId", Type: "bytes32"}, {Name: "executionSpecId", Type: "bytes32"}, {Name: "status", Type: "uint8"}}
var stockQuoteFields = []events.Input{{Name: "assetUid", Type: "bytes32"}, {Name: "stockTokenFingerprintHash", Type: "bytes32"}, {Name: "referenceEvidenceHash", Type: "bytes32"}, {Name: "generatorPolicyId", Type: "bytes32"}}

// ObserveConfigBlock refreshes complete known records at one block hash. Registry
// current-identity and component code checks are observations, not source audits.
func ObserveConfigBlock(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, targets []ConfigTarget) (ObservationBatch, error) {
	fail := func(e error) (ObservationBatch, error) { return ObservationBatch{}, e }
	unique := map[string]ConfigTarget{}
	for _, target := range targets {
		if (target.Kind != "quote" && target.Kind != "baseline" && target.Kind != "template") || !hex32.MatchString(target.ID) || target.ID == zero32 {
			return fail(errors.New("invalid configuration target"))
		}
		unique[target.Kind+":"+target.ID] = target
	}
	if len(unique) > MaxConfigReads {
		return fail(errors.New("configuration observation budget exceeded"))
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if _, e := VerifyCoreBindings(ctx, rpc, m, block); e != nil {
		return fail(e)
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		roots[c.Module] = c.Address
	}
	batch := ObservationBatch{Scope: ConfigObservationScope, ChainID: m.ChainID, BlockNumber: block.Number, BlockHash: block.Hash, Expected: len(unique), Observations: []StateObservation{}}
	keys := map[string]bool{}
	for k := range unique {
		keys[k] = true
	}
	read := businessReader(ctx, rpc, block)
	for _, key := range sortedSet(keys) {
		target := unique[key]
		address, signature, fields := roots["ApprovedQuoteRegistry"], "quoteConfig(bytes32)", quoteConfigFields
		if target.Kind == "baseline" {
			address, signature, fields = roots["TickerGardenBaselineRegistry"], "baseline(bytes32)", baselineConfigFields
		}
		if target.Kind == "template" {
			address, signature, fields = roots["LaunchTemplateRegistry"], "launchTemplate(bytes32)", templateConfigFields
		}
		value, e := read(address, signature, target.ID[2:], fields)
		if e != nil {
			return fail(e)
		}
		if status := value["status"]; status != "1" && status != "2" && status != "3" {
			return fail(errors.New("configuration missing or invalid status"))
		}
		if target.Kind == "quote" {
			binding, e := read(address, "stockQuoteBinding(bytes32)", target.ID[2:], stockQuoteFields)
			if e != nil {
				return fail(e)
			}
			value["stockQuoteBinding"] = binding
			for _, getter := range []struct{ signature, name, typ string }{{"quoteRuntimeCodeHash(bytes32)", "runtimeCodeHash", "bytes32"}, {"quoteIdentityCurrent(bytes32)", "identityCurrent", "bool"}} {
				v, e := read(address, getter.signature, target.ID[2:], []events.Input{{Name: getter.name, Type: getter.typ}})
				if e != nil {
					return fail(e)
				}
				value[getter.name] = v[getter.name]
			}
		}
		if target.Kind == "template" {
			v, e := read(address, "launchTemplateHash(bytes32)", target.ID[2:], []events.Input{{Name: "templateHash", Type: "bytes32"}})
			if e != nil {
				return fail(e)
			}
			// Match the Registry's v2 static ABI hash, which excludes mutable status.
			encoded, _ := hex.DecodeString(Hash([]byte("TICKERGARDEN_V1_LAUNCH_TEMPLATE"))[2:])
			encoded = append(encoded, make([]byte, 31)...)
			encoded = append(encoded, 2)
			for _, field := range templateConfigFields[:12] {
				word := strings.TrimPrefix(value[field.Name].(string), "0x")
				word = strings.Repeat("0", 64-len(word)) + word
				raw, e := hex.DecodeString(word)
				if e != nil {
					return fail(e)
				}
				encoded = append(encoded, raw...)
			}
			if v["templateHash"] != Hash(encoded) {
				return fail(errors.New("configuration template hash mismatch"))
			}
			value["templateHash"] = v["templateHash"]
			current := true
			for i := 0; i < 10; i += 2 {
				component := value[templateConfigFields[i].Name].(string)
				code, e := rpc.CodeAt(ctx, component, block.Hash)
				if e != nil {
					return fail(errors.New("template component code unavailable"))
				}
				if component == zero20 || len(code) == 0 || Hash(code) != value[templateConfigFields[i+1].Name] {
					current = false
				}
			}
			value["componentCodeIdentityCurrent"] = current
		}
		batch.Observations = append(batch.Observations, StateObservation{Kind: target.Kind, Key: target.ID, Value: value})
	}
	end, e := rpc.Header(ctx, block.Number)
	if e != nil {
		return fail(e)
	}
	if end.Hash != block.Hash || end.Number != block.Number || end.Timestamp != block.Timestamp {
		return fail(errors.New("configuration observation block changed"))
	}
	return batch, nil
}
