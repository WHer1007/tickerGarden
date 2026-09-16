package readmodel

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func fixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func object(t *testing.T) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(fixture(t), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func invalid(t *testing.T, v map[string]any) {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Parse(b, 46630); err == nil {
		t.Fatal("expected invalid snapshot")
	}
}

func TestParseFixturePreservesRawAmountsAndOptionalArrays(t *testing.T) {
	s, err := Parse(fixture(t), 46630)
	if err != nil {
		t.Fatal(err)
	}
	if s.Markets == nil || s.Configs == nil || s.Positions == nil {
		t.Fatal("optional arrays must be non-nil")
	}
	if got := s.Markets[0].CurveProgress.RealQuoteReserve; got != "900719925474099312345" {
		t.Fatalf("amount converted: %s", got)
	}

	v := object(t)
	delete(v, "markets")
	delete(v, "configs")
	delete(v, "positions")
	b, _ := json.Marshal(v)
	if _, err := Parse(b, 46630); err != nil {
		t.Fatal(err)
	}
}

func TestParseRejectsMalformedAndProtocolViolations(t *testing.T) {
	if _, e := Parse(fixture(t), 46630); e != nil {
		t.Fatal(e)
	}
	for _, tc := range []struct{ name, raw string }{
		{"missing required", `{"executionSpecId":"V1-EXEC-11","reconciliationAlerts":[]}`},
		{"null sync", `{"executionSpecId":"V1-EXEC-11","reconciliationAlerts":[],"sync":null}`},
		{"duplicate keys", strings.Replace(string(fixture(t)), `"markets":`, `"markets":null,"markets":`, 1)},
		{"trailing JSON", string(fixture(t)) + " {}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Parse([]byte(tc.raw), 46630); err == nil {
				t.Fatal("accepted invalid input")
			}
		})
	}

	cases := []struct{ name, path, value string }{
		{"revision", "sync.revision", "bad"}, {"chain", "sync.chainId", "1"}, {"finality", "sync.finality", "safe"},
		{"future source", "markets[0].source.blockNumber", "2"}, {"allocated", "positions[0].allocated", "999"},
		{"claim asset", "positions[0].claimable[0].asset", "0x0000000000000000000000000000000000000099"},
		{"phase route", "markets[0].canonicalRoute.poolTradingEnabled", "true"}, {"minimum allocation", "configs[0].values.minimumAllocation", "413"},
		{"uint256 overflow", "markets[0].curveProgress.realQuoteReserve", "115792089237316195423570985008687907853269984665640564039457584007913129639936"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { v := object(t); setPath(v, tc.path, tc.value); invalid(t, v) })
	}
	dup := object(t)
	ms := dup["markets"].([]any)
	dup["markets"] = append(ms, ms[0])
	invalid(t, dup)
}

func setPath(v map[string]any, path, value string) {
	parts := strings.FieldsFunc(path, func(r rune) bool { return r == '.' || r == '[' || r == ']' })
	var cur any = v
	for i, p := range parts {
		if i == len(parts)-1 {
			switch x := cur.(type) {
			case map[string]any:
				x[p] = value
			case []any: /* paths used here index only */
			}
			return
		}
		switch x := cur.(type) {
		case map[string]any:
			cur = x[p]
		case []any:
			var n int
			json.Unmarshal([]byte(p), &n)
			cur = x[n]
		}
	}
}

func TestContractCopyAndAdditionalInvariants(t *testing.T) {
	source, e := os.ReadFile("../../openapi/v1.json")
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(source, OpenAPI) {
		t.Fatal("embedded OpenAPI drift; run generator")
	}
	v := object(t)
	v["unexpected"] = true
	invalid(t, v)
	v = object(t)
	m := v["markets"].([]any)[0].(map[string]any)
	m["canonicalRoute"].(map[string]any)["poolTradingEnabled"] = true
	invalid(t, v)
	v = object(t)
	m = v["markets"].([]any)[0].(map[string]any)
	m["poolId"] = "0x" + strings.Repeat("a", 64)
	invalid(t, v)
	v = object(t)
	delete(v["markets"].([]any)[0].(map[string]any), "sourceVersion")
	invalid(t, v)
}

func TestOptionalIdentityValidation(t *testing.T) {
	for _, kind := range []string{"valid", "future", "wrong hash", "null time", "overflow time", "byte limit"} {
		t.Run(kind, func(t *testing.T) {
			v := object(t)
			m := v["markets"].([]any)[0].(map[string]any)
			source := m["source"].(map[string]any)
			identity := map[string]any{"name": "苹果", "symbol": "TREE", "metadataURI": "", "deployedAt": "100", "blockNumber": source["blockNumber"], "blockHash": source["blockHash"], "runtimeCodeHash": "0x" + strings.Repeat("a", 64)}
			m["identity"] = identity
			switch kind {
			case "future":
				identity["blockNumber"] = "9223372036854775807"
			case "wrong hash":
				identity["blockHash"] = "0x" + strings.Repeat("b", 64)
			case "null time":
				identity["deployedAt"] = nil
			case "overflow time":
				identity["deployedAt"] = "9223372036854775808"
			case "byte limit":
				identity["name"] = strings.Repeat("苹", 1366)
			}
			if kind != "valid" {
				invalid(t, v)
				return
			}
			raw, _ := json.Marshal(v)
			if _, e := Parse(raw, 46630); e != nil {
				t.Fatal(e)
			}
		})
	}
}
