package readmodel

import (
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

type emitterBinding struct {
	module string
	from   uint64
}
type candidateEmitterBindings struct {
	addresses map[string]emitterBinding
	registry  string
}

// This verifies address/module provenance from an operator manifest and creation
// events. It does not re-read historical runtime code or Registry state via RPC.
func newCandidateEmitterBindings(manifest deployment.Manifest, discoveries map[string]deployment.MarketDiscovery) (*candidateEmitterBindings, error) {
	bad := errors.New("candidate emitter binding unavailable")
	data, e := json.Marshal(manifest)
	if e != nil {
		return nil, bad
	}
	if _, e := deployment.Parse(data); e != nil {
		return nil, bad
	}
	b := &candidateEmitterBindings{addresses: map[string]emitterBinding{}}
	factory := ""
	for _, c := range manifest.Contracts {
		b.addresses[c.Address] = emitterBinding{module: c.Module}
		if c.Module == "TickerGardenFactoryV1" {
			if factory != "" {
				return nil, bad
			}
			factory = c.Address
		}
		if c.Module == "OfficialStockRegistryV1" {
			if b.registry != "" {
				return nil, bad
			}
			b.registry = c.Address
		}
	}
	instances := map[string]bool{}
	for id, d := range discoveries {
		if id != d.MarketID || factory == "" || d.Source.Address != factory {
			return nil, bad
		}
		input := projection.Input{ChainID: manifest.ChainID, Module: "TickerGardenFactoryV1", Log: d.Source, Observations: []projection.Observation{{Kind: "market", Key: id, Value: projection.Row(d.State)}}}
		if verifyCandidateInputViews(input, discoveries) != nil {
			return nil, bad
		}
		height, e := strconv.ParseUint(d.Source.BlockNumber, 0, 64)
		if e != nil {
			return nil, bad
		}
		for _, pair := range [][2]string{{"memeToken", "TickerMemeTokenV1"}, {"curve", "TickerGardenCurve"}, {"gauge", "MemeStockGauge"}} {
			address, ok := d.State[pair[0]].(string)
			if !ok || !candidateAddress.MatchString(address) {
				return nil, bad
			}
			if address == "0x"+strings.Repeat("0", 40) {
				if pair[0] != "gauge" {
					return nil, bad
				}
				continue
			}
			if instances[address] {
				return nil, bad
			}
			instances[address] = true
			if old, ok := b.addresses[address]; ok && old.module != pair[1] {
				return nil, bad
			}
			b.addresses[address] = emitterBinding{module: pair[1], from: height}
		}
	}
	return b, nil
}
func (b *candidateEmitterBindings) check(input projection.Input) error {
	bad := errors.New("candidate event emitter mismatch")
	binding, ok := b.addresses[input.Log.Address]
	height, e := strconv.ParseUint(input.Log.BlockNumber, 0, 64)
	if !ok || e != nil || height < binding.from || binding.module != input.Module {
		return bad
	}
	decoded, e := events.Decode(binding.module, input.Log)
	if e != nil {
		return bad
	}
	if input.Module == "OfficialStockRegistryV1" && strings.HasPrefix(decoded.Signature, "AssetRegistered(") {
		if input.Log.Address != b.registry {
			return bad
		}
		vault, ok := decoded.Args["userStockVault"].(string)
		if !ok || !candidateAddress.MatchString(vault) || vault == "0x"+strings.Repeat("0", 40) {
			return bad
		}
		if old, ok := b.addresses[vault]; ok && old.module != "UserStockVault" {
			return bad
		}
		if _, ok := b.addresses[vault]; !ok {
			b.addresses[vault] = emitterBinding{module: "UserStockVault", from: height}
		}
	}
	return nil
}
func candidateManifestHash(m deployment.Manifest) string {
	m.Contracts = append([]deployment.Contract{}, m.Contracts...)
	sort.Slice(m.Contracts, func(i, j int) bool { return m.Contracts[i].Address < m.Contracts[j].Address })
	data, e := json.Marshal(m)
	if e != nil {
		return ""
	}
	return deployment.Hash(data)
}
