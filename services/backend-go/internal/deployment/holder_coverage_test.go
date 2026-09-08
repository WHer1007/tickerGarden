package deployment

import (
	"context"
	"fmt"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func TestKnownHolderCoverage(t *testing.T) {
	for _, continuous := range []bool{false, true} {
		for _, mode := range []string{"valid", "balance", "total", "reverse", "missing", "duplicate", "disabled", "accounting", "reorg", "RPC unavailable", "bad native quantity"} {
			t.Run(fmt.Sprintf("continuous=%t/%s", continuous, mode), func(t *testing.T) {
				var f *feeFixture
				var b chainrpc.Header
				var markets map[string]MarketDiscovery
				var distributor, id string
				if continuous {
					f, b, markets, _, distributor, id = continuousSetup(t, true)
				} else {
					f, b, markets, distributor = holderSetup(t)
					for id = range markets {
					}
				}
				registry := ""
				for _, c := range f.manifest.Contracts {
					if c.Module == "MarketRegistryV1" {
						registry = c.Address
					}
				}
				// Fixture helpers change discovery state; encode the same current Registry row.
				key := registry + Hash([]byte("market(bytes32)"))[:10] + id[2:]
				raw := append([]byte{}, f.calls[key]...)
				copy(raw[12*32:13*32], addrWord(markets[id].State["quoteAsset"].(string)))
				copy(raw[15*32:16*32], bytesWord("1"))
				if mode == "disabled" {
					copy(raw[15*32:16*32], bytesWord("0"))
				}
				f.calls[key] = raw
				if mode == "missing" {
					delete(f.calls, key)
				}
				if mode == "reverse" {
					f.calls[registry+Hash([]byte("marketIdByToken(address)"))[:10]+addressArgument(markets[id].State["memeToken"].(string))] = bytesWord(zero32)
				}
				if mode == "balance" {
					f.balances[distributor] = "0"
				}
				if mode == "total" {
					sig := "totalQuoteLiability(address)"
					if continuous {
						sig = "totalLiability(address)"
					}
					f.calls[distributor+Hash([]byte(sig))[:10]+addressArgument(zero20)] = bytesWord("1")
				}
				if mode == "accounting" {
					if continuous {
						k := distributor + Hash([]byte("marketState(bytes32)"))[:10] + id[2:]
						data := append([]byte{}, f.calls[k]...)
						copy(data[12*32:13*32], bytesWord("4")) // paid exceeds funded=3
						f.calls[k] = data
					} else {
						k := distributor + Hash([]byte("epochQuoteAmount(bytes32,uint32)"))[:10] + id[2:] + fmt.Sprintf("%064x", 1)
						f.calls[k] = bytesWord("2") // claimed=3 exceeds funded
					}
				}
				ids := []string{id}
				if mode == "duplicate" {
					ids = append(ids, id)
				}
				e := VerifyKnownHolderCoverage(context.Background(), f, f.manifest, b, ids)
				valid := mode == "valid" || mode == "disabled"
				if (e == nil) != (valid || mode == "reorg" || mode == "RPC unavailable" || mode == "bad native quantity") {
					t.Fatal(mode, e)
				}
				client, reads := holderCoverageHTTPFixture(t, f, b, mode)
				observed, e := ObserveVerifiedKnownHolders(context.Background(), client, f.manifest, b, ids)
				if (e == nil) != valid {
					t.Fatal("HTTP", mode, e)
				}
				if valid && (observed.Scope != "known-holder-coverage-v1" || observed.Expected != len(observed.Observations) || observed.Observations[len(observed.Observations)-1].Kind != "market") {
					t.Fatal("incomplete candidate evidence", observed)
				}
				if !valid && len(observed.Observations) != 0 {
					t.Fatal("partial failed evidence")
				}
				if valid && reads.Load() == 0 {
					t.Fatal("no HTTP state reads")
				}
			})
		}
	}
}
