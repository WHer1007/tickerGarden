// Package deployment authenticates operator-supplied runtime identities against
// hash-pinned chain state. A runtime template hash is never deployment evidence.
package deployment

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"

	"golang.org/x/crypto/sha3"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

type Contract struct {
	Module          string `json:"module"`
	Address         string `json:"address"`
	RuntimeCodeHash string `json:"runtimeCodeHash"`
}
type Manifest struct {
	ExecutionSpecID string     `json:"executionSpecId"`
	ChainID         uint64     `json:"chainId"`
	GenesisHash     string     `json:"genesisHash"`
	Contracts       []Contract `json:"contracts"`
	Bootstrap       *Bootstrap `json:"bootstrap,omitempty"`
}

// Bootstrap commits complete pre-business event coverage for a staged
// deployment. It never permits omitting protocol events from the projection.
type Bootstrap struct {
	Version              uint64 `json:"version"`
	DeploymentStartBlock uint64 `json:"deploymentStartBlock"`
	DeploymentStartHash  string `json:"deploymentStartHash"`
	BusinessStartBlock   uint64 `json:"businessStartBlock"`
	BusinessStartHash    string `json:"businessStartHash"`
	EvidenceHash         string `json:"evidenceHash"`
}
type Observer interface {
	ChainID(context.Context) (uint64, error)
	Header(context.Context, string) (chainrpc.Header, error)
	CodeAt(context.Context, string, string) ([]byte, error)
}
type Verified struct {
	chain     uint64
	hash      string
	contracts map[string]string
}

var hex32 = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var hex20 = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

func Hash(code []byte) string {
	h := sha3.NewLegacyKeccak256()
	h.Write(code)
	return "0x" + hex.EncodeToString(h.Sum(nil))
}
func Parse(data []byte) (Manifest, error) {
	var m Manifest
	if len(data) > 1<<20 {
		return m, errors.New("deployment manifest exceeds limit")
	}
	probe := json.NewDecoder(bytes.NewReader(data))
	if e := unique(probe, 0); e != nil {
		return m, errors.New("duplicate or invalid manifest JSON")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if e := d.Decode(&m); e != nil {
		return m, errors.New("invalid deployment manifest JSON")
	}
	if d.Decode(new(any)) != io.EOF {
		return m, errors.New("trailing deployment manifest JSON")
	}
	if e := validate(m); e != nil {
		return m, e
	}
	return m, nil
}
func validate(m Manifest) error {
	if m.ExecutionSpecID != "V1-EXEC-11" || (m.ChainID != 4663 && m.ChainID != 46630 && m.ChainID != 421614) || !hex32.MatchString(m.GenesisHash) || len(m.Contracts) == 0 || len(m.Contracts) > 256 {
		return errors.New("invalid deployment identity scope")
	}
	seen := map[string]bool{}
	if b := m.Bootstrap; b != nil {
		if b.Version != 1 || b.DeploymentStartBlock == 0 || b.BusinessStartBlock <= b.DeploymentStartBlock || b.BusinessStartBlock-b.DeploymentStartBlock > 4096 || !hex32.MatchString(b.DeploymentStartHash) || !hex32.MatchString(b.BusinessStartHash) || !hex32.MatchString(b.EvidenceHash) {
			return errors.New("invalid deployment bootstrap commitment")
		}
	}
	for _, c := range m.Contracts {
		if !hex20.MatchString(c.Address) || c.Address == "0x"+strings.Repeat("0", 40) || !hex32.MatchString(c.RuntimeCodeHash) || seen[c.Address] || !events.HasModule(c.Module) {
			return errors.New("invalid, duplicate or unsupported deployment contract")
		}
		seen[c.Address] = true
	}
	return nil
}
func Verify(ctx context.Context, rpc Observer, m Manifest, block chainrpc.Header) (Verified, error) {
	v := Verified{}
	if e := validate(m); e != nil {
		return v, e
	}
	if _, err := block.Height(); err != nil {
		return v, errors.New("invalid verification height")
	}
	if !hex32.MatchString(block.Hash) {
		return v, errors.New("invalid verification block")
	}
	id, e := rpc.ChainID(ctx)
	if e != nil {
		return v, e
	}
	if id != m.ChainID {
		return v, errors.New("deployment chain mismatch")
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil {
		return v, e
	}
	if !strings.EqualFold(genesis.Hash, m.GenesisHash) {
		return v, errors.New("deployment genesis mismatch")
	}
	check := func() error {
		h, e := rpc.Header(ctx, block.Number)
		if e != nil {
			return e
		}
		if !strings.EqualFold(h.Hash, block.Hash) {
			return errors.New("deployment verification block changed")
		}
		return nil
	}
	if e = check(); e != nil {
		return v, e
	}
	var codes [][]byte
	if parallel, ok := rpc.(parallelCodes); ok {
		addresses := make([]string, len(m.Contracts))
		for i, c := range m.Contracts {
			addresses[i] = c.Address
		}
		codes, e = parallel.CodesAt(ctx, addresses, block.Hash)
		if e != nil {
			return v, e
		}
		if len(codes) != len(m.Contracts) {
			return v, errors.New("incomplete runtime code batch")
		}
	}
	resolved := map[string]string{}
	for i, c := range m.Contracts {
		var code []byte
		if codes != nil {
			code = codes[i]
		} else {
			code, e = rpc.CodeAt(ctx, c.Address, block.Hash)
		}
		if e != nil {
			return v, e
		}
		if len(code) == 0 || Hash(code) != c.RuntimeCodeHash {
			return v, errors.New("deployed runtime code hash mismatch")
		}
		resolved[c.Address] = c.Module
	}
	if e = check(); e != nil {
		return v, e
	}
	return Verified{chain: m.ChainID, hash: block.Hash, contracts: resolved}, nil
}

// Decode prevents an authenticated identity result from being reused at another
// block or chain. Dynamic contract/Factory relationship discovery is separate.
// CheckScope also validates empty batches, where no log reaches Decode.
func (v Verified) CheckScope(chain uint64, blockHash string) error {
	if len(v.contracts) == 0 || chain != v.chain || !strings.EqualFold(blockHash, v.hash) {
		return errors.New("event is outside verified identity block")
	}
	return nil
}

func (v Verified) Decode(chain uint64, log chainrpc.Log) (events.Decoded, error) {
	if v.CheckScope(chain, log.BlockHash) != nil {
		return events.Decoded{}, errors.New("event is outside verified identity block")
	}
	module, ok := v.contracts[strings.ToLower(log.Address)]
	if !ok {
		return events.Decoded{}, events.ErrUnknown
	}
	return events.Decode(module, log)
}

// Reject duplicate keys before decoding the identity commitments.
func unique(d *json.Decoder, depth int) error {
	if depth > 32 {
		return errors.New("manifest nesting limit")
	}
	t, e := d.Token()
	if e != nil {
		return e
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			token, e := d.Token()
			if e != nil {
				return e
			}
			key, ok := token.(string)
			if !ok || seen[key] {
				return errors.New("duplicate key")
			}
			seen[key] = true
			if e = unique(d, depth+1); e != nil {
				return e
			}
		}
	case '[':
		for d.More() {
			if e = unique(d, depth+1); e != nil {
				return e
			}
		}
	default:
		return errors.New("invalid delimiter")
	}
	_, e = d.Token()
	return e
}
