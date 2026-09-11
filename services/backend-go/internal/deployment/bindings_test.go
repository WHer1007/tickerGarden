package deployment

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

type bindingFixture struct {
	manifest       Manifest
	calls          map[string][]byte
	headers, reads int
	reorg          bool
	callError      bool
	badCode        bool
}

func (f *bindingFixture) ChainID(context.Context) (uint64, error) { return 46630, nil }
func (f *bindingFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	h := blockHash
	if tag == "0x0" {
		h = genesisHash
	} else {
		f.headers++
		if f.reorg && f.headers == 3 {
			h = genesisHash
		}
	}
	return chainrpc.Header{Number: tag, Hash: h}, nil
}
func (f *bindingFixture) CodeAt(_ context.Context, a, h string) ([]byte, error) {
	if h != blockHash {
		return nil, errors.New("unpinned code")
	}
	if f.badCode {
		return []byte{1}, nil
	}
	for _, c := range f.manifest.Contracts {
		if c.Address == a {
			return []byte{0}, nil
		}
	}
	return nil, errors.New("unexpected code target")
}
func (f *bindingFixture) CallAt(ctx context.Context, a, data, h string) ([]byte, error) {
	f.reads++
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.callError {
		return nil, errors.New("secret provider endpoint")
	}
	if h != blockHash {
		return nil, errors.New("unpinned call")
	}
	if strings.HasPrefix(data, Hash([]byte("userClaimMode()"))[:10]) {
		if value, ok := f.calls[a+data]; ok {
			return value, nil
		}
		return bytesWord(strings.TrimPrefix(userClaimModeV1, "0x")), nil
	}
	value, ok := f.calls[a+data]
	if !ok {
		return nil, errors.New("unexpected ABI call")
	}
	return value, nil
}
func bindingWord(a string) []byte {
	b, _ := hex.DecodeString(strings.Repeat("0", 24) + a[2:])
	return b
}
func newBindingFixture() *bindingFixture {
	// Literal selectors checked against the compiled Solidity methodIdentifiers.
	modules := []string{"TickerGardenFactoryV1", "OfficialStockRegistryV1", "ApprovedQuoteRegistry", "TickerGardenBaselineRegistry", "LaunchTemplateRegistry", "MarketRegistryV1", "ProtocolFeeVault", "AllocationManager", "LaunchAndBuyRouter"}
	f := &bindingFixture{manifest: Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 46630, GenesisHash: genesisHash}, calls: map[string][]byte{}}
	addresses := map[string]string{}
	for i, module := range modules {
		a := fmt.Sprintf("0x%040x", i+1)
		addresses[module] = a
		f.manifest.Contracts = append(f.manifest.Contracts, Contract{Module: module, Address: a, RuntimeCodeHash: Hash([]byte{0})})
	}
	var tuple []byte
	for _, module := range modules[1:] {
		tuple = append(tuple, bindingWord(addresses[module])...)
	}
	f.calls[addresses[modules[0]]+"0x4dffb637"] = tuple
	for selector, module := range map[string]string{"0xc45a0155": "TickerGardenFactoryV1", "0xe4acb862": "OfficialStockRegistryV1", "0xc246f6ac": "ApprovedQuoteRegistry", Hash([]byte("tickerGardenBaselineRegistry()"))[:10]: "TickerGardenBaselineRegistry", "0x2774537b": "LaunchTemplateRegistry"} {
		f.calls[addresses["MarketRegistryV1"]+selector] = bindingWord(addresses[module])
	}
	f.calls[addresses["ApprovedQuoteRegistry"]+"0xe4acb862"] = bindingWord(addresses["OfficialStockRegistryV1"])
	return f
}
func TestCoreBindings(t *testing.T) {
	f := newBindingFixture()
	v, err := VerifyCoreBindings(context.Background(), f, f.manifest, chainrpc.Header{Number: "0x1", Hash: blockHash})
	if err != nil || f.reads != 7 || f.headers != 3 || v.chain != 46630 || v.hash != blockHash || len(v.contracts) != 9 {
		t.Fatalf("verification: %+v reads=%d headers=%d err=%v", v, f.reads, f.headers, err)
	}
}
func TestCoreBindingsRejectEveryMismatchedEdge(t *testing.T) {
	original := newBindingFixture()
	for key, data := range original.calls {
		for word := 0; word < len(data)/32; word++ {
			t.Run(fmt.Sprintf("%s/%d", key, word), func(t *testing.T) {
				f := newBindingFixture()
				f.calls[key][word*32+31] = 0xfe
				v, err := VerifyCoreBindings(context.Background(), f, f.manifest, chainrpc.Header{Number: "0x1", Hash: blockHash})
				if err == nil || v.contracts != nil {
					t.Fatal("accepted mismatched deployment edge")
				}
			})
		}
	}
}
func TestCoreBindingsFailClosed(t *testing.T) {
	for name, mutate := range map[string]func(*bindingFixture){
		"missing": func(f *bindingFixture) { f.manifest.Contracts = f.manifest.Contracts[:8] },
		"ambiguous": func(f *bindingFixture) {
			c := f.manifest.Contracts[0]
			c.Address = address
			f.manifest.Contracts = append(f.manifest.Contracts, c)
		},
		"wrong code":        func(f *bindingFixture) { f.badCode = true },
		"reorg after calls": func(f *bindingFixture) { f.reorg = true },
		"rpc failure":       func(f *bindingFixture) { f.callError = true },
		"short ABI": func(f *bindingFixture) {
			for k, v := range f.calls {
				f.calls[k] = v[:len(v)-1]
			}
		},
		"trailing ABI": func(f *bindingFixture) {
			for k, v := range f.calls {
				f.calls[k] = append(v, make([]byte, 32)...)
			}
		},
		"dirty padding": func(f *bindingFixture) {
			for _, v := range f.calls {
				v[0] = 1
			}
		},
		"zero address": func(f *bindingFixture) {
			for k, v := range f.calls {
				f.calls[k] = make([]byte, len(v))
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := newBindingFixture()
			mutate(f)
			v, err := VerifyCoreBindings(context.Background(), f, f.manifest, chainrpc.Header{Number: "0x1", Hash: blockHash})
			if err == nil || v.contracts != nil {
				t.Fatal("invalid proof accepted")
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatal("provider error leaked")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	f := newBindingFixture()
	if _, err := VerifyCoreBindings(ctx, f, f.manifest, chainrpc.Header{Number: "0x1", Hash: blockHash}); err == nil {
		t.Fatal("cancelled verification accepted")
	}
}
