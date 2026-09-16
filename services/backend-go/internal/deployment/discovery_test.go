package deployment

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
	"tickergarden/backend/internal/events"

	"tickergarden/backend/internal/chainrpc"
)

type discoveryFixture struct {
	*bindingFixture
	observation chainrpc.Observation
	observeErr  error
	headers     int
	finalReorg  bool
	code        map[string][]byte
}

func (f *discoveryFixture) Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error) {
	if f.observeErr != nil {
		return chainrpc.Observation{}, f.observeErr
	}
	return f.observation, nil
}
func (f *discoveryFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	f.headers++
	if tag == "0x0" {
		return chainrpc.Header{Number: tag, Hash: genesisHash}, nil
	}
	h := blockHash
	if f.finalReorg && f.headers == 5 {
		h = genesisHash
	}
	return chainrpc.Header{Number: tag, Hash: h}, nil
}
func (f *discoveryFixture) CodeAt(_ context.Context, a, h string) ([]byte, error) {
	if h != blockHash {
		return nil, errors.New("unpinned")
	}
	if b, ok := f.code[a]; ok {
		return b, nil
	}
	return f.bindingFixture.CodeAt(context.Background(), a, h)
}
func wordHex(s string) string  { return "0x" + strings.Repeat("0", 64-len(s)) + s }
func addrWord(a string) []byte { return bindingWord(a) }
func bytesWord(s string) []byte {
	s = strings.TrimPrefix(s, "0x")
	if len(s)%2 == 1 {
		s = "0" + s
	}
	b, _ := hex.DecodeString(s)
	return append(make([]byte, 32-len(b)), b...)
}
func discoverySetup(t *testing.T, staking, graduated bool) (*discoveryFixture, chainrpc.Header, string) {
	f := &discoveryFixture{bindingFixture: newBindingFixture(), code: map[string][]byte{}}
	factory := f.manifest.Contracts[0].Address
	registry := f.manifest.Contracts[5].Address
	id := wordHex("aa")
	asset := wordHex("bb")
	if !staking {
		asset = zero32
	}
	token := "0x" + strings.Repeat("a", 40)
	curve := "0x" + strings.Repeat("b", 40)
	gauge := zero20
	if staking {
		gauge = "0x" + strings.Repeat("c", 40)
	}
	quote := "0x" + strings.Repeat("d", 40)
	hook := "0x" + strings.Repeat("0", 36) + "2044"
	baseline := wordHex("11")
	qc := wordHex("22")
	econ := wordHex("33")
	data := []byte{}
	for _, v := range [][]byte{addrWord(curve), addrWord(gauge), addrWord(quote), bytesWord(baseline), bytesWord(qc), bytesWord(econ)} {
		data = append(data, v...)
	}
	log := chainrpc.Log{Address: factory, BlockHash: blockHash, Topics: []string{"0x6a858729b3663fb6b88c7ab55523860e884a7abcc31f02538303bf7cd4e1b4f1", id, asset, wordHex(strings.Repeat("a", 40))}, Data: "0x" + hex.EncodeToString(data)}
	state := []byte{}
	phase, pool, version, enabled := "0", zero32, "1", "0"
	if staking {
		enabled = "1"
	}
	if graduated {
		phase, pool, version = "1", wordHex("99"), "2"
	}
	// Literal canonical 17-word MarketConfig followed by 3-word MarketRuntime.
	for _, value := range []string{
		asset, baseline, qc, wordHex("44"), wordHex("55"), Hash([]byte("V1-EXEC-11")), econ, "1",
		token, token, curve, gauge, quote, hook, "64", "0", enabled, pool, version, phase,
	} {
		state = append(state, bytesWord(value)...)
	}
	f.calls[registry+Hash([]byte("market(bytes32)"))[:10]+id[2:]] = state
	f.calls[registry+Hash([]byte("marketIdByToken(address)"))[:10]+strings.Repeat("0", 24)+token[2:]] = bytesWord(id)
	f.observation.Logs = []chainrpc.Log{log}
	f.code[token] = []byte{1}
	f.code[curve] = []byte{1}
	if staking {
		f.code[gauge] = []byte{1}
	}
	return f, chainrpc.Header{Number: "0x1", Hash: blockHash}, id
}
func TestDiscoverBlockEnabledDisabledAndGraduated(t *testing.T) {
	for _, x := range []struct{ staking, graduated bool }{{true, false}, {false, false}, {true, true}} {
		f, b, _ := discoverySetup(t, x.staking, x.graduated)
		got, e := DiscoverBlock(context.Background(), f, f.manifest, b)
		if e != nil || len(got) != 1 {
			t.Fatalf("staking=%v graduated=%v: %v calls=%d", x.staking, x.graduated, e, len(f.calls))
		}
		if len(got[0].Contracts) != 2+boolCount(x.staking) || got[0].State["stakingEnabled"] != x.staking || f.headers != 5 {
			t.Fatal("incorrect discovery output", got)
		}
	}
}
func boolCount(v bool) int {
	if v {
		return 1
	}
	return 0
}
func TestDiscoverBlockRejectsObservationAndReorg(t *testing.T) {
	for _, mut := range []func(*discoveryFixture){func(f *discoveryFixture) { f.observeErr = errors.New("observe") }, func(f *discoveryFixture) { f.finalReorg = true }} {
		f, b, _ := discoverySetup(t, true, false)
		mut(f)
		if _, e := DiscoverBlock(context.Background(), f, f.manifest, b); e == nil {
			t.Fatal("accepted invalid observation")
		}
	}
}
func TestDiscoverBlockRejectsZeroRuntime(t *testing.T) {
	f, b, _ := discoverySetup(t, true, false)
	f.code["0x"+strings.Repeat("a", 40)] = nil
	if _, e := DiscoverBlock(context.Background(), f, f.manifest, b); e == nil {
		t.Fatal("accepted zero runtime")
	}
}

func TestDiscoverRejectsMalformedRecordsAndIdentity(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*discoveryFixture, string)
	}{
		{"event state mismatch", func(f *discoveryFixture, k string) { f.calls[k][31] ^= 1 }},
		{"zero gauge enabled", func(f *discoveryFixture, k string) {
			copy(f.calls[k][11*32:12*32], make([]byte, 32))
			log := &f.observation.Logs[0]
			data, _ := hex.DecodeString(log.Data[2:])
			copy(data[32:64], make([]byte, 32))
			log.Data = "0x" + hex.EncodeToString(data)
		}},
		{"disabled staking retains asset", func(f *discoveryFixture, k string) { f.calls[k][16*32+31] = 0 }},
		{"bad boolean", func(f *discoveryFixture, k string) { f.calls[k][16*32+31] = 2 }},
		{"dirty address", func(f *discoveryFixture, k string) { f.calls[k][8*32] = 1 }},
		{"short record", func(f *discoveryFixture, k string) { f.calls[k] = f.calls[k][:639] }},
		{"long record", func(f *discoveryFixture, k string) { f.calls[k] = append(f.calls[k], make([]byte, 32)...) }},
		{"wrong spec", func(f *discoveryFixture, k string) { f.calls[k][5*32+31] ^= 1 }},
		{"excess tax", func(f *discoveryFixture, k string) { copy(f.calls[k][14*32:15*32], bytesWord("1f5")) }},
		{"hook flags", func(f *discoveryFixture, k string) { f.calls[k][13*32+31] ^= 1 }},
		{"wrong version", func(f *discoveryFixture, k string) { f.calls[k][18*32+31] = 2 }},
		{"duplicate creation", func(f *discoveryFixture, k string) {
			f.observation.Logs = append(f.observation.Logs, f.observation.Logs[0])
		}},
		{"reverse mismatch", func(f *discoveryFixture, k string) {
			for key, value := range f.calls {
				if strings.Contains(key, "0x69b62bd3") {
					value[31] ^= 1
				}
			}
		}},
		{"instance alias", func(f *discoveryFixture, k string) {
			copy(f.calls[k][10*32:11*32], f.calls[k][9*32:10*32])
			log := &f.observation.Logs[0]
			data, _ := hex.DecodeString(log.Data[2:])
			copy(data[:32], f.calls[k][9*32:10*32])
			log.Data = "0x" + hex.EncodeToString(data)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			f, b, id := discoverySetup(t, true, false)
			k := f.manifest.Contracts[5].Address + "0x5c60e39a" + id[2:]
			test.mutate(f, k)
			got, err := DiscoverBlock(context.Background(), f, f.manifest, b)
			if err == nil || got != nil {
				t.Fatal("invalid discovery accepted", got, err)
			}
		})
	}
}
func TestDiscoverIgnoresForeignEmitter(t *testing.T) {
	f, b, _ := discoverySetup(t, true, false)
	f.observation.Logs[0].Address = "0x" + strings.Repeat("f", 40)
	got, err := DiscoverBlock(context.Background(), f, f.manifest, b)
	if err != nil || got == nil || len(got) != 0 {
		t.Fatal("foreign creation trusted", got, err)
	}
}
func TestMarketFieldsMatchCompiledABI(t *testing.T) {
	type component struct {
		Name       string      `json:"name"`
		Type       string      `json:"type"`
		Components []component `json:"components"`
	}
	var artifact struct {
		ABI []struct {
			Type    string      `json:"type"`
			Name    string      `json:"name"`
			Outputs []component `json:"outputs"`
		} `json:"abi"`
	}
	raw, err := os.ReadFile("../../../../contracts/out-v1/MarketRegistryV1.sol/MarketRegistryV1.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &artifact); err != nil {
		t.Fatal(err)
	}
	var actual []events.Input
	var flatten func([]component)
	flatten = func(values []component) {
		for _, v := range values {
			if v.Type == "tuple" {
				flatten(v.Components)
			} else {
				actual = append(actual, events.Input{Name: v.Name, Type: v.Type})
			}
		}
	}
	for _, entry := range artifact.ABI {
		if entry.Type == "function" && entry.Name == "market" {
			flatten(entry.Outputs)
		}
	}
	if !reflect.DeepEqual(actual, marketFields) {
		t.Fatalf("MarketView ABI drift: %#v", actual)
	}
}
