package readmodel

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

func TestCandidateEmitterBindings(t *testing.T) {
	raw, err := os.ReadFile("../projection/testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name  string
		Input projection.Input
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	var registration, deposit projection.Input
	for _, f := range fixtures {
		if f.Name == "AssetRegistered" {
			registration = f.Input
		}
		if f.Name == "StockDeposited" {
			deposit = f.Input
		}
	}
	if deposit.Module == "" {
		t.Fatal("missing deposit fixture")
	}
	vault := "0x" + strings.Repeat("0", 39) + "9"
	registration.Log.Topics[3] = "0x" + strings.Repeat("0", 63) + "9"
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 46630, GenesisHash: "0x" + strings.Repeat("1", 64), Contracts: []deployment.Contract{{Module: registration.Module, Address: registration.Log.Address, RuntimeCodeHash: "0x" + strings.Repeat("2", 64)}}}
	for _, mode := range []string{"valid", "unknown address", "wrong module", "vault collision", "zero vault", "before registration", "before creation"} {
		t.Run(mode, func(t *testing.T) {
			guard, e := newCandidateEmitterBindings(manifest, nil)
			if e != nil {
				t.Fatal(e)
			}
			input := registration
			input.Log.Topics = append([]string(nil), registration.Log.Topics...)
			switch mode {
			case "unknown address":
				input.Log.Address = vault
			case "wrong module":
				input.Module = "UserStockVault"
			case "vault collision":
				input.Log.Topics[3] = "0x" + strings.Repeat("0", 63) + "8"
			case "zero vault":
				input.Log.Topics[3] = "0x" + strings.Repeat("0", 64)
			case "before registration":
				input = deposit
				input.Log.Address = vault
			case "before creation":
				guard.addresses[input.Log.Address] = emitterBinding{module: input.Module, from: 11}
			}
			e = guard.check(input)
			if (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
			if mode == "valid" {
				d := deposit
				d.Log.Address = vault
				d.Log.BlockNumber = "0xa"
				if e := guard.check(d); e != nil {
					t.Fatal(e)
				}
				d.Log.BlockNumber = "0x9"
				if guard.check(d) == nil {
					t.Fatal("vault before registration height accepted")
				}
			}
		})
	}
	duplicate := manifest
	duplicate.Contracts = append(append([]deployment.Contract(nil), manifest.Contracts...), deployment.Contract{Module: registration.Module, Address: vault, RuntimeCodeHash: "0x" + strings.Repeat("3", 64)})
	if _, e := newCandidateEmitterBindings(duplicate, nil); e == nil {
		t.Fatal("ambiguous registry accepted")
	}
}

func TestCandidateDynamicEmitterBindings(t *testing.T) {
	raw, e := os.ReadFile("../projection/testdata/golden.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures []struct {
		Name  string
		Input projection.Input
	}
	if e = json.Unmarshal(raw, &fixtures); e != nil {
		t.Fatal(e)
	}
	var input projection.Input
	for _, f := range fixtures {
		if f.Name == "MarketCreated" {
			input = f.Input
			break
		}
	}
	decoded, e := events.Decode(input.Module, input.Log)
	if e != nil {
		t.Fatal(e)
	}
	id := decoded.Args["marketId"].(string)
	state := map[string]any{}
	for k, v := range decoded.Args {
		if k != "marketId" {
			state[k] = v
		}
	}
	d := deployment.MarketDiscovery{MarketID: id, Source: input.Log, State: state}
	m := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 46630, GenesisHash: "0x" + strings.Repeat("1", 64), Contracts: []deployment.Contract{{Module: input.Module, Address: input.Log.Address, RuntimeCodeHash: "0x" + strings.Repeat("2", 64)}}}
	guard, e := newCandidateEmitterBindings(m, map[string]deployment.MarketDiscovery{id: d})
	if e != nil {
		t.Fatal(e)
	}
	for field, module := range map[string]string{"memeToken": "TickerMemeTokenV1", "curve": "TickerGardenCurve", "gauge": "MemeStockGauge"} {
		b, ok := guard.addresses[state[field].(string)]
		if !ok || b.module != module || b.from != 10 {
			t.Fatal(field, b)
		}
	}
	other := d
	other.MarketID = "0x" + strings.Repeat("7", 64)
	other.Source.Topics = append([]string(nil), d.Source.Topics...)
	other.Source.Topics[1] = other.MarketID
	if _, e := newCandidateEmitterBindings(m, map[string]deployment.MarketDiscovery{id: d, other.MarketID: other}); e == nil {
		t.Fatal("shared market instances accepted")
	}
	d.Source.Address = "0x" + strings.Repeat("9", 40)
	if _, e := newCandidateEmitterBindings(m, map[string]deployment.MarketDiscovery{id: d}); e == nil {
		t.Fatal("unknown factory accepted")
	}
}
