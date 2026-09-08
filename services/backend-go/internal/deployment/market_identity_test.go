package deployment

import (
	"context"
	"encoding/binary"
	"fmt"
	"testing"
)

func identityString(s string) []byte {
	raw := make([]byte, 64+((len(s)+31)/32)*32)
	raw[31] = 32
	binary.BigEndian.PutUint64(raw[56:64], uint64(len(s)))
	copy(raw[64:], s)
	return raw
}

type identityReorgRPC struct {
	*requestFixture
	reorg bool
}

func (f *identityReorgRPC) CallAt(ctx context.Context, address, data, block string) ([]byte, error) {
	raw, e := f.requestFixture.CallAt(ctx, address, data, block)
	if f.reorg && data == Hash([]byte("deployedAt()"))[:10] {
		f.lateReorg = true
		f.sourceReads = 2
	}
	return raw, e
}
func TestMarketIdentityPinnedAndFailClosed(t *testing.T) {
	for _, name := range []string{"valid", "reverse", "market binding", "factory binding", "runtime", "name ABI", "URI ABI", "future timestamp", "late reorg"} {
		t.Run(name, func(t *testing.T) {
			f, b, id, _, _ := requestSetup(t)
			var registry, factory string
			for _, c := range f.manifest.Contracts {
				if c.Module == "MarketRegistryV1" {
					registry = c.Address
				}
				if c.Module == "TickerGardenFactoryV1" {
					factory = c.Address
				}
			}
			row := f.calls[registry+Hash([]byte("market(bytes32)"))[:10]+id[2:]]
			token := fmt.Sprintf("0x%x", row[9*32+12:10*32])
			key := func(signature string) string { return token + Hash([]byte(signature))[:10] }
			f.calls[key("marketId()")] = bytesWord(id)
			f.calls[key("factory()")] = addrWord(factory)
			f.calls[key("name()")] = identityString("花园 Garden")
			f.calls[key("symbol()")] = identityString("GARDEN")
			f.calls[key("metadataURI()")] = identityString("https://metadata.invalid/untrusted.json")
			f.calls[key("deployedAt()")] = bytesWord(fmt.Sprintf("%x", f.now-100))
			switch name {
			case "reverse":
				f.calls[registry+Hash([]byte("marketIdByToken(address)"))[:10]+fmt.Sprintf("%064s", token[2:])] = bytesWord(blockHash)
			case "market binding":
				f.calls[key("marketId()")] = bytesWord(blockHash)
			case "factory binding":
				f.calls[key("factory()")] = addrWord(zero20)
			case "runtime":
				f.code[token] = nil
			case "name ABI":
				f.calls[key("name()")] = []byte{0}
			case "URI ABI":
				f.calls[key("metadataURI()")] = append(identityString("uri"), 0)
			case "future timestamp":
				f.calls[key("deployedAt()")] = bytesWord(fmt.Sprintf("%x", f.now+1))
			case "late reorg":
				// Reorg is injected after the final metadata getter.
			}
			got, e := ObserveMarketIdentity(context.Background(), &identityReorgRPC{requestFixture: f, reorg: name == "late reorg"}, f.manifest, b, id)
			if name == "valid" {
				if e != nil || got.Name != "花园 Garden" || got.Symbol != "GARDEN" || got.MemeToken != token || got.DeployedAt != fmt.Sprint(f.now-100) || got.RuntimeCodeHash != Hash(f.code[token]) || got.BlockHash != b.Hash {
					t.Fatal(got, e)
				}
			} else if e == nil || got.MarketID != "" {
				t.Fatal("invalid observation accepted", got, e)
			}
		})
	}
}
