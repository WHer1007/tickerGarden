package readmodel

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"strconv"
	"sync"
	"unicode/utf8"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed openapi.json
var OpenAPI []byte

const MaxSnapshotBytes = 16 << 20

var schemaOnce sync.Once
var snapshotSchema *jsonschema.Schema
var schemaError error

func compiler() (*jsonschema.Compiler, error) {
	var doc map[string]any
	dec := json.NewDecoder(bytes.NewReader(OpenAPI))
	dec.UseNumber()
	if err := dec.Decode(&doc); err != nil {
		return nil, err
	}
	ref := func(name string) any { return map[string]any{"$ref": "#/components/schemas/" + name} }
	array := func(name string) any { return map[string]any{"type": "array", "items": ref(name)} }
	doc["$schema"] = "https://json-schema.org/draft/2020-12/schema"
	doc["type"] = "object"
	doc["additionalProperties"] = false
	doc["required"] = []string{"executionSpecId", "reconciliationAlerts", "sync"}
	doc["properties"] = map[string]any{"executionSpecId": map[string]any{"const": "V1-EXEC-11"}, "reconciliationAlerts": map[string]any{"type": "array", "maxItems": 0}, "sync": ref("SyncStatus"), "markets": array("MarketReadModel"), "configs": array("ConfigReadModel"), "positions": array("UserPositionReadModel"), "accounts": array("UserAccountReadModel")}
	encoded, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	resource, err := jsonschema.UnmarshalJSON(bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource("https://tickergarden.invalid/snapshot.json", resource); err != nil {
		return nil, err
	}
	return c, nil
}

// ValidateResponse checks exactly the frozen frontend schema. It never loads
// request-supplied schemas or remote references.
func ValidateResponse(name string, data []byte) error {
	c, e := compiler()
	if e != nil {
		return e
	}
	s, e := c.Compile("https://tickergarden.invalid/snapshot.json#/components/schemas/" + name)
	if e != nil {
		return e
	}
	v, e := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	if e != nil {
		return e
	}
	return s.Validate(v)
}

// JSON's last-key-wins behavior is unsafe at a publication boundary. Walk the
// tokens first so duplicate fields and excessive nesting cannot be normalized away.
func uniqueJSON(d *json.Decoder, depth int) error {
	if depth > 64 {
		return errors.New("JSON nesting exceeds limit")
	}
	token, e := d.Token()
	if e != nil {
		return e
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			t, e := d.Token()
			if e != nil {
				return e
			}
			key, ok := t.(string)
			if !ok || seen[key] {
				return errors.New("duplicate JSON object field")
			}
			seen[key] = true
			if e = uniqueJSON(d, depth+1); e != nil {
				return e
			}
		}
	case '[':
		for d.More() {
			if e = uniqueJSON(d, depth+1); e != nil {
				return e
			}
		}
	default:
		return errors.New("invalid JSON delimiter")
	}
	_, e = d.Token()
	return e
}
func Parse(data []byte, chainID uint64) (Snapshot, error) {
	var s Snapshot
	if len(data) > MaxSnapshotBytes {
		return s, errors.New("snapshot exceeds 16 MiB")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	if e := uniqueJSON(d, 0); e != nil {
		return s, e
	}
	if _, e := d.Token(); e != io.EOF {
		return s, errors.New("snapshot must contain exactly one JSON value")
	}
	schemaOnce.Do(func() {
		c, e := compiler()
		if e != nil {
			schemaError = e
			return
		}
		snapshotSchema, schemaError = c.Compile("https://tickergarden.invalid/snapshot.json")
	})
	if schemaError != nil {
		return s, errors.New("cannot compile snapshot contract")
	}
	v, e := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	if e != nil {
		return s, errors.New("invalid snapshot JSON")
	}
	if e = snapshotSchema.Validate(v); e != nil {
		return s, errors.New("snapshot violates V1 OpenAPI schema")
	}
	s, e = decodeSnapshot(data)
	if e != nil {
		return s, e
	}
	return s, validate(s, chainID)
}

// Decode into new maps/slices even when validation of these exact bytes is cached.
func decodeSnapshot(data []byte) (Snapshot, error) {
	var s Snapshot
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	if e := d.Decode(&s); e != nil {
		return s, errors.New("snapshot field cannot be represented")
	}
	if s.Markets == nil {
		s.Markets = []MarketReadModel{}
	}
	if s.Configs == nil {
		s.Configs = []ConfigReadModel{}
	}
	if s.Positions == nil {
		s.Positions = []UserPositionReadModel{}
	}
	return s, nil
}
func raw(v string) (*big.Int, error) {
	n, ok := new(big.Int).SetString(v, 10)
	if !ok || n.Sign() < 0 || n.BitLen() > 256 {
		return nil, errors.New("amount exceeds uint256")
	}
	return n, nil
}
func Height(s string) (uint64, error) { return strconv.ParseUint(s, 10, 63) }
func validate(s Snapshot, chain uint64) error {
	bad := func() error { return errors.New("snapshot violates cross-field protocol invariants") }
	sync := s.Sync
	if sync.ChainID != chain || sync.Status != "synced" || sync.Finality != "finalized" || sync.BlockNumber == nil || sync.BlockHash == nil || sync.HeadBlockNumber == nil || sync.HeadBlockHash == nil || sync.LagBlocks == nil {
		return bad()
	}
	n, e := Height(*sync.BlockNumber)
	if e != nil {
		return bad()
	}
	head, e := Height(*sync.HeadBlockNumber)
	if e != nil || head < n {
		return bad()
	}
	lag, e := Height(*sync.LagBlocks)
	if e != nil || lag != head-n || sync.Revision != *sync.BlockNumber+":"+*sync.BlockHash {
		return bad()
	}
	if head == n && *sync.HeadBlockHash != *sync.BlockHash {
		return bad()
	}
	source := func(p SourceBlock) bool {
		number, e := Height(p.BlockNumber)
		return e == nil && number <= n && p.ChainID == chain && p.TransactionIndex <= 1<<53-1 && p.LogIndex <= 1<<53-1
	}
	markets := map[string]MarketReadModel{}
	for _, m := range s.Markets {
		if _, exists := markets[m.MarketID]; exists || !source(m.Source) {
			return bad()
		}
		if identity := m.Identity; identity != nil {
			creation, e := Height(identity.BlockNumber)
			marketBlock, _ := Height(m.Source.BlockNumber)
			if e != nil || creation > marketBlock || (creation == marketBlock && identity.BlockHash != m.Source.BlockHash) {
				return bad()
			}
			if _, e = Height(identity.DeployedAt); e != nil {
				return bad()
			}
			if len(identity.Name) > 4096 || len(identity.Symbol) > 4096 || len(identity.MetadataURI) > 16384 || !utf8.ValidString(identity.Name+identity.Symbol+identity.MetadataURI) {
				return bad()
			}
		}
		markets[m.MarketID] = m
		r := m.CanonicalRoute
		if m.SourceVersion > 1<<32-1 || r.SourceVersion != m.SourceVersion || r.LaunchPhase != m.LaunchPhase || (m.PoolID == nil) != (m.PoolKey == nil) {
			return bad()
		}
		if m.LaunchPhase == 0 && (m.PoolID != nil || !r.CurveTradingEnabled || r.PoolTradingEnabled) {
			return bad()
		}
		if m.LaunchPhase == 1 && (m.PoolID == nil || r.CurveTradingEnabled || !r.PoolTradingEnabled) {
			return bad()
		}
		if m.PoolKey != nil {
			a, b := m.MemeToken, m.QuoteAsset
			if a > b {
				a, b = b, a
			}
			if m.PoolKey.Currency0 != a || m.PoolKey.Currency1 != b || m.PoolKey.Hooks != r.Hook {
				return bad()
			}
		}
		p := m.CurveProgress
		for _, v := range []string{p.RealQuoteReserve, p.SellableTokens, p.ReservedTokens, p.AccruedCurveFees} {
			if _, e := raw(v); e != nil {
				return e
			}
		}
	}
	seen := map[string]bool{}
	for _, c := range s.Configs {
		k := c.Kind + ":" + c.ID
		if seen[k] || !source(c.Source) {
			return bad()
		}
		seen[k] = true
		if c.Kind == "asset" {
			v, ok := c.Values["minimumAllocation"].(string)
			if !ok {
				return bad()
			}
			n, e := raw(v)
			if e != nil || n.Cmp(big.NewInt(414)) < 0 || n.String() != v {
				return bad()
			}
		}
	}
	seen = map[string]bool{}
	for _, p := range s.Positions {
		k := p.User + ":" + p.AssetUID + ":" + p.MarketID
		if seen[k] || !source(p.Source) {
			return bad()
		}
		seen[k] = true
		for _, v := range []string{p.Free, p.Allocated, p.Pending, p.Active, p.Claimable[0].Amount, p.Claimable[1].Amount} {
			if _, e := raw(v); e != nil {
				return e
			}
		}
		for _, v := range []*string{p.ActivationAt, p.UnlockAt} {
			if v != nil {
				if _, e := raw(*v); e != nil {
					return e
				}
			}
		}
		allocated, _ := raw(p.Allocated)
		pending, _ := raw(p.Pending)
		active, _ := raw(p.Active)
		if allocated.Cmp(new(big.Int).Add(pending, active)) != 0 {
			return bad()
		}
		m, ok := markets[p.MarketID]
		if !ok || m.AssetUID != p.AssetUID || p.Claimable[0].Asset != m.QuoteAsset || p.Claimable[1].Asset != m.MemeToken {
			return bad()
		}
	}
	return validateAccounts(s)
}
func Empty(chain uint64) Snapshot {
	return Snapshot{ExecutionSpecID: "V1-EXEC-11", ReconciliationAlerts: []json.RawMessage{}, Sync: SyncStatus{ChainID: chain, Status: "unavailable", Finality: "unavailable", Revision: "unavailable"}, Markets: []MarketReadModel{}, Configs: []ConfigReadModel{}, Positions: []UserPositionReadModel{}}
}
