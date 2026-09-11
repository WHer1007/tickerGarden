package deployment

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func continuousSetup(t *testing.T, native bool) (*feeFixture, chainrpc.Header, map[string]MarketDiscovery, map[string]string, string, string) {
	t.Helper()
	f, b, markets, _, _ := feeSetup(t, native)
	var id string
	for id = range markets {
		m := markets[id]
		m.State["creatorFeesToHolders"] = true
		markets[id] = m
	}
	m := markets[id]
	roots := map[string]string{}
	for _, c := range f.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	distributor := "0x" + strings.Repeat("8", 40)
	f.code[distributor] = []byte{8}
	f.manifest.Contracts = append(f.manifest.Contracts, Contract{Module: "HolderRewardsDistributorV1", Address: distributor, RuntimeCodeHash: Hash(f.code[distributor])})
	token := m.State["memeToken"].(string)
	quote := m.State["quoteAsset"].(string)
	mode := Hash([]byte("TICKERGARDEN_HOLDER_STREAM_24H_V1"))
	set := func(addr, sig, args string, data []byte) { f.calls[addr+Hash([]byte(sig))[:10]+args] = data }
	set(roots["TickerGardenFactoryV1"], "treasuryDistributor()", "", addrWord(distributor))
	set(distributor, "marketRegistry()", "", addrWord(roots["MarketRegistryV1"]))
	set(distributor, "rewardMode()", "", bytesWord(mode))
	set(distributor, "STREAM_DURATION()", "", bytesWord(fmt.Sprintf("%x", 86400)))
	set(token, "treasuryDistributor()", "", addrWord(distributor))
	f.code[token] = []byte{1}
	marketState := append(addrWord(token), addrWord(quote)...)
	marketState = append(marketState, addrWord(roots["ProtocolFeeVault"])...)
	for _, v := range []string{"100", "1", "2", "3", "4", "5", "6", "7", "3", "0"} {
		marketState = append(marketState, bytesWord(v)...)
	}
	set(distributor, "marketState(bytes32)", id[2:], marketState)
	release := append(bytesWord("4"), bytesWord("5")...)
	release = append(release, bytesWord("6")...)
	release = append(release, bytesWord("7")...)
	set(distributor, "releaseState(bytes32)", id[2:], release)
	set(distributor, "lastFundingAt(bytes32)", id[2:], bytesWord("99"))
	set(distributor, "totalLiability(address)", addressArgument(quote), bytesWord("3"))
	f.balances[distributor] = "3"
	if quote != zero20 {
		set(quote, "balanceOf(address)", addressArgument(distributor), bytesWord("3"))
	}
	f.headers = 0
	return f, b, markets, roots, distributor, id
}

func TestObserveContinuousHoldersNativeAndERC20(t *testing.T) {
	for _, native := range []bool{true, false} {
		t.Run(fmt.Sprintf("native=%t", native), func(t *testing.T) {
			f, b, markets, roots, distributor, _ := continuousSetup(t, native)
			batch, err := observeContinuousHolders(context.Background(), f, f.manifest, b, markets, roots, distributor, f.code[distributor])
			if err != nil {
				t.Fatal(err)
			}
			if batch.Scope != HolderObservationScope || batch.Expected != 2 || len(batch.Observations) != 2 {
				t.Fatalf("unexpected batch: %+v", batch)
			}
			for _, row := range batch.Observations {
				if row.Kind != "holderMarket" {
					continue
				}
				if row.Value["rewardMode"] != "continuous-24h" || row.Value["streamDuration"] != "86400" {
					t.Fatalf("missing continuous identity: %+v", row)
				}
				if checks, ok := row.Value["checks"].(map[string]bool); ok {
					for name, passed := range checks {
						if !passed {
							t.Fatalf("failed %s: %+v", name, row)
						}
					}
				}
			}
			for key := range f.calls {
				if strings.Contains(key, "epoch(") || strings.Contains(key, "root") || strings.Contains(key, "TWAB") {
					t.Fatalf("called legacy root/epoch interface: %s", key)
				}
			}
		})
	}
}

func TestObserveContinuousHoldersRejectsWithoutPartialBatch(t *testing.T) {
	for _, name := range []string{"mode", "duration", "binding", "codehash", "market", "paid>funded", "reorg"} {
		t.Run(name, func(t *testing.T) {
			f, b, markets, roots, distributor, id := continuousSetup(t, true)
			token := markets[id].State["memeToken"].(string)
			switch name {
			case "mode":
				f.calls[distributor+Hash([]byte("rewardMode()"))[:10]] = bytesWord(Hash([]byte("OLD")))
			case "duration":
				f.calls[distributor+Hash([]byte("STREAM_DURATION()"))[:10]] = bytesWord("604800")
			case "binding":
				f.calls[token+Hash([]byte("treasuryDistributor()"))[:10]] = addrWord(zero20)
			case "codehash":
				f.code[distributor] = []byte{9}
			case "market":
				key := distributor + Hash([]byte("marketState(bytes32)"))[:10] + id[2:]
				copy(f.calls[key][0:32], addrWord(zero20))
			case "paid>funded":
				key := distributor + Hash([]byte("marketState(bytes32)"))[:10] + id[2:]
				copy(f.calls[key][12*32:13*32], bytesWord("101"))
			case "reorg":
				f.finalReorg = true
				f.headers = 4
			}
			code := []byte{8}
			if name == "codehash" {
				code = []byte{9}
			}
			batch, err := observeContinuousHolders(context.Background(), f, f.manifest, b, markets, roots, distributor, code)
			if err == nil || batch.Scope != "" || len(batch.Observations) != 0 {
				t.Fatalf("accepted partial/invalid batch: %+v, %v", batch, err)
			}
		})
	}
}

func TestObserveHolderBlockRoutesContinuousManifest(t *testing.T) {
	f, b, markets, _, _, _ := continuousSetup(t, true)
	batch, err := ObserveHolderBlock(context.Background(), f, f.manifest, b, markets)
	if err != nil {
		t.Fatal(err)
	}
	if batch.Expected != 2 {
		t.Fatal("continuous routing did not return expected observations")
	}
}

func TestObserveBatchedHoldersPinsModeAndCodeWithoutLegacyCalls(t *testing.T) {
	f, b, markets, roots, distributor, _ := continuousSetup(t, true)
	mode := Hash([]byte(BatchedContinuousHolderMode))
	f.calls[distributor+Hash([]byte("rewardMode()"))[:10]] = bytesWord(mode)
	batch, err := observeContinuousHolders(context.Background(), f, f.manifest, b, markets, roots, distributor, f.code[distributor])
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range batch.Observations {
		if row.Kind == "holderMarket" && row.Value["rewardModeHash"] != mode {
			t.Fatal("missing version identity")
		}
	}
	f.manifest.Contracts[len(f.manifest.Contracts)-1].RuntimeCodeHash = Hash([]byte{99})
	if _, err = observeContinuousHolders(context.Background(), f, f.manifest, b, markets, roots, distributor, f.code[distributor]); err == nil {
		t.Fatal("accepted changed code for supported mode")
	}
}

func TestObserveDualHolderChecksBothAssetLiabilities(t *testing.T) {
	f, b, markets, roots, d, id := continuousSetup(t, false)
	token := markets[id].State["memeToken"].(string)
	f.calls[d+Hash([]byte("rewardMode()"))[:10]] = bytesWord(Hash([]byte(DualAssetContinuousHolderMode)))
	state := append(addrWord(token), addrWord(token)...)
	state = append(state, addrWord(roots["ProtocolFeeVault"])...)
	for _, v := range []string{"100", "1", "2", "3", "4", "5", "6", "7", "3", "0"} {
		state = append(state, bytesWord(v)...)
	}
	f.calls[d+Hash([]byte("memeMarketState(bytes32)"))[:10]+id[2:]] = state
	f.calls[d+Hash([]byte("totalLiability(address)"))[:10]+addressArgument(token)] = bytesWord("3")
	f.calls[token+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(d)] = bytesWord("3")
	batch, err := observeContinuousHolders(context.Background(), f, f.manifest, b, markets, roots, d, f.code[d])
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Observations) != 3 || batch.Observations[0].Value["memeRewards"] == nil {
		t.Fatal(batch)
	}
}
