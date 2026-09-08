package deployment

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func holderSetup(t *testing.T) (*feeFixture, chainrpc.Header, map[string]MarketDiscovery, string) {
	t.Helper()
	f, b, markets, _, _ := feeSetup(t, true)
	var id string
	for k := range markets {
		id = k
	}
	m := markets[id]
	m.State["creatorFeesToHolders"] = true
	markets[id] = m
	roots := map[string]string{}
	for _, c := range f.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	distributor := "0x" + strings.Repeat("8", 40)
	f.code[distributor] = []byte{8}
	f.calls[distributor+Hash([]byte("EPOCH_DURATION()"))[:10]] = bytesWord(fmt.Sprintf("%x", 7*24*60*60))
	f.calls[distributor+Hash([]byte("TWAB_SCHEMA()"))[:10]] = bytesWord(Hash([]byte("TRANSFER_LOG_TWAB_1H_R6_TEST_ONLY")))
	f.calls[roots["TickerGardenFactoryV1"]+Hash([]byte("treasuryDistributor()"))[:10]] = addrWord(distributor)
	f.calls[distributor+Hash([]byte("marketRegistry()"))[:10]] = addrWord(roots["MarketRegistryV1"])
	f.calls[distributor+Hash([]byte("rootServiceFee()"))[:10]] = append(addrWord(zero20), bytesWord("2")...)
	f.calls[distributor+Hash([]byte("feeSharingVault(bytes32)"))[:10]+id[2:]] = addrWord(roots["ProtocolFeeVault"])
	f.calls[distributor+Hash([]byte("currentEpochId(bytes32)"))[:10]+id[2:]] = bytesWord("2")
	market := append([]byte{}, addrWord(m.State["memeToken"].(string))...)
	market = append(market, addrWord(m.State["quoteAsset"].(string))...)
	market = append(market, bytesWord(strings.Repeat("1", 64))...)
	market = append(market, bytesWord("1")...)
	f.calls[distributor+Hash([]byte("market(bytes32)"))[:10]+id[2:]] = market
	token := m.State["memeToken"].(string)
	f.calls[token+Hash([]byte("treasuryDistributor()"))[:10]] = addrWord(distributor)
	// Discovery pinned this exact runtime hash; preserve it for the happy path.
	for _, c := range m.Contracts {
		if c.Module == "TickerMemeTokenV1" {
			f.code[token] = []byte{1}
		}
	}
	for epoch := 1; epoch <= 2; epoch++ {
		args := id[2:] + fmt.Sprintf("%064x", epoch)
		status, funded, committed, claimed := "3", "a", "a", "3"
		if epoch == 2 {
			status, funded = "4", "0"
		}
		row := []string{"1", "2", "3", "4", "5", "1", status, "0x" + strings.Repeat("0", 40), zero20, "0", strings.Repeat("2", 64), strings.Repeat("3", 64), strings.Repeat("4", 64), committed, claimed, "20"}
		data := []byte{}
		for _, v := range row {
			if strings.HasPrefix(v, "0x") && len(v) == 42 {
				data = append(data, addrWord(v)...)
			} else {
				data = append(data, bytesWord(v)...)
			}
		}
		f.calls[distributor+Hash([]byte("epoch(bytes32,uint32)"))[:10]+args] = data
		f.calls[distributor+Hash([]byte("epochQuoteAmount(bytes32,uint32)"))[:10]+args] = bytesWord(funded)
		f.calls[distributor+Hash([]byte("epochWindow(bytes32,uint32)"))[:10]+args] = append(bytesWord("1"), bytesWord("2")...)
		for _, asset := range []string{zero20, token} {
			f.calls[roots["ProtocolFeeVault"]+Hash([]byte("holderLiability(bytes32,uint32,address)"))[:10]+args+addressArgument(asset)] = bytesWord("0")
		}
	}
	for _, asset := range []string{zero20, token} {
		f.calls[roots["ProtocolFeeVault"]+Hash([]byte("liability(bytes32,address,uint8)"))[:10]+id[2:]+addressArgument(asset)+fmt.Sprintf("%064x", 3)] = bytesWord("0")
		f.calls[distributor+Hash([]byte("totalQuoteLiability(address)"))[:10]+addressArgument(asset)] = bytesWord("7")
		f.calls[distributor+Hash([]byte("totalServiceLiability(address)"))[:10]+addressArgument(asset)] = bytesWord("2")
	}
	f.balances[distributor] = "9"
	f.headers = 0
	return f, b, markets, distributor
}

func TestObserveHolderBlockSemantics(t *testing.T) {
	f, b, markets, distributor := holderSetup(t)
	batch, err := ObserveHolderBlock(context.Background(), f, f.manifest, b, markets)
	if err != nil {
		t.Fatal(err)
	}
	if batch.Scope != HolderObservationScope || batch.Expected != 4 || len(batch.Observations) != 4 {
		t.Fatalf("%+v", batch)
	}
	if batch.Observations[0].Value["outstandingQuoteAmount"] != "7" || batch.Observations[1].Value["outstandingQuoteAmount"] != "0" {
		t.Fatal("rolled funding counted")
	}
	for _, o := range batch.Observations {
		if checks, ok := o.Value["checks"].(map[string]bool); ok {
			for name, passed := range checks {
				if !passed {
					t.Fatal(name, o)
				}
			}
		}
		if o.Kind == "treasurySolvency" && o.Key == distributor+":"+zero20 && o.Value["requiredBalance"] != "9" {
			t.Fatal(o)
		}
	}
}

func TestObserveHolderBlockRejectsAndPreservesEmpty(t *testing.T) {
	f, b, markets, _ := holderSetup(t)
	for k, v := range markets {
		v.State["creatorFeesToHolders"] = false
		markets[k] = v
	}
	batch, err := ObserveHolderBlock(context.Background(), f, f.manifest, b, markets)
	if err != nil || batch.Scope != HolderObservationScope || len(batch.Observations) != 0 {
		t.Fatal(batch, err)
	}
}

func TestHolderInvalidInputsReturnNoPartialBatch(t *testing.T) {
	for _, name := range []string{"registry", "token binding", "token code", "treasury code", "vault", "market", "status", "epoch budget", "late balance", "native malformed", "reorg"} {
		t.Run(name, func(t *testing.T) {
			f, b, markets, d := holderSetup(t)
			var id string
			for key := range markets {
				id = key
			}
			token := markets[id].State["memeToken"].(string)
			switch name {
			case "registry":
				f.calls[d+Hash([]byte("marketRegistry()"))[:10]] = addrWord(zero20)
			case "token binding":
				f.calls[token+Hash([]byte("treasuryDistributor()"))[:10]] = addrWord(zero20)
			case "token code":
				f.code[token] = []byte{9}
			case "treasury code":
				f.code[d] = nil
			case "vault":
				f.calls[d+Hash([]byte("feeSharingVault(bytes32)"))[:10]+id[2:]] = addrWord(zero20)
			case "market":
				f.calls[d+Hash([]byte("market(bytes32)"))[:10]+id[2:]] = make([]byte, 128)
			case "status":
				key := d + Hash([]byte("epoch(bytes32,uint32)"))[:10] + id[2:] + fmt.Sprintf("%064x", 1)
				copy(f.calls[key][6*32:7*32], bytesWord("5"))
			case "epoch budget":
				f.calls[d+Hash([]byte("currentEpochId(bytes32)"))[:10]+id[2:]] = bytesWord(fmt.Sprintf("%x", MaxHolderEpochReads+1))
			case "late balance":
				f.balanceErr = true
			case "native malformed":
				f.balances[d] = "01"
			case "reorg":
				f.finalReorg = true
			}
			batch, e := ObserveHolderBlock(context.Background(), f, f.manifest, b, markets)
			if e == nil || batch.Scope != "" || len(batch.Observations) != 0 {
				t.Fatal("partial or accepted invalid batch", batch, e)
			}
		})
	}
}

func TestHolderRiskChecksPersist(t *testing.T) {
	f, b, markets, d := holderSetup(t)
	f.balances[d] = "8"
	var id string
	for key := range markets {
		id = key
	}
	// Corrupt the old rolled-over funding counter: retain a failed check but do
	// not count the already moved funds twice in outstanding quote liabilities.
	f.calls[d+Hash([]byte("epochQuoteAmount(bytes32,uint32)"))[:10]+id[2:]+fmt.Sprintf("%064x", 2)] = bytesWord("7")
	batch, e := ObserveHolderBlock(context.Background(), f, f.manifest, b, markets)
	if e != nil {
		t.Fatal(e)
	}
	badBalance, badRollover := false, false
	for _, row := range batch.Observations {
		checks, _ := row.Value["checks"].(map[string]bool)
		if row.Kind == "treasurySolvency" {
			badBalance = !checks["balanceCoversLiabilities"]
			if row.Value["knownHolderMarketOutstanding"] != "7" || row.Value["fullReconciliation"] != false {
				t.Fatal(row)
			}
		}
		if row.Kind == "holderEpoch" && row.Value["status"] == "4" {
			badRollover = !checks["rolledOverFundingCleared"]
		}
	}
	if !badBalance || !badRollover {
		t.Fatal("risk evidence lost", batch)
	}
}

func TestHolderHistoricalServiceAssetObserved(t *testing.T) {
	f, b, markets, d := holderSetup(t)
	var id string
	for key := range markets {
		id = key
	}
	historical := "0x" + strings.Repeat("9", 40)
	key := d + Hash([]byte("epoch(bytes32,uint32)"))[:10] + id[2:] + fmt.Sprintf("%064x", 1)
	copy(f.calls[key][8*32:9*32], addrWord(historical))
	copy(f.calls[key][9*32:10*32], bytesWord("2"))
	f.calls[d+Hash([]byte("totalQuoteLiability(address)"))[:10]+addressArgument(historical)] = bytesWord("0")
	f.calls[d+Hash([]byte("totalServiceLiability(address)"))[:10]+addressArgument(historical)] = bytesWord("2")
	f.calls[historical+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(d)] = bytesWord("2")
	batch, e := ObserveHolderBlock(context.Background(), f, f.manifest, b, markets)
	if e != nil {
		t.Fatal(e)
	}
	if batch.Expected != 5 || len(batch.Observations) != 5 {
		t.Fatal(batch)
	}
	found := false
	for _, row := range batch.Observations {
		if row.Kind == "treasurySolvency" && row.Value["asset"] == historical {
			found = true
			if row.Value["requiredBalance"] != "2" || !row.Value["checks"].(map[string]bool)["balanceCoversLiabilities"] {
				t.Fatal(row)
			}
		}
	}
	if !found {
		t.Fatal("historical service fee asset omitted")
	}
}
