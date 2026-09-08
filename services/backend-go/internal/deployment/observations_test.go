package deployment

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func businessFixture(t *testing.T) (*discoveryFixture, chainrpc.Header, map[string]MarketDiscovery, []chainrpc.Log, string) {
	t.Helper()
	f, b, id := discoverySetup(t, false, false)
	found, err := DiscoverBlock(context.Background(), f, f.manifest, b)
	if err != nil {
		t.Fatal(err)
	}
	f.headers = 0
	for _, c := range found[0].Contracts {
		f.manifest.Contracts = append(f.manifest.Contracts, c)
	}
	market := found[0]
	curve := market.State["curve"].(string)
	for _, signature := range []string{"realQuoteReserve()", "sellableTokens()", "reservedTokens()", "accruedCurveFees()", "accruedCreatorTax()", "sweepNonce()"} {
		f.calls[curve+Hash([]byte(signature))[:10]] = bytesWord("123")
	}
	f.calls[curve+Hash([]byte("quoteAsset()"))[:10]] = addrWord(market.State["quoteAsset"].(string))
	f.calls[curve+Hash([]byte("creatorTaxBps()"))[:10]] = bytesWord("64")
	f.calls[curve+Hash([]byte("readyToGraduate()"))[:10]] = bytesWord("0")
	f.calls[curve+Hash([]byte("getReserves()"))[:10]] = append(bytesWord(strings.Repeat("f", 64)), bytesWord("123")...)
	creation := f.observation.Logs[0]
	creation.BlockNumber = b.Number
	completed := chainrpc.Log{Address: curve, BlockHash: b.Hash, BlockNumber: b.Number, Topics: []string{Hash([]byte("CurveCompleted(bytes32)")), id}, Data: "0x"}
	return f, b, map[string]MarketDiscovery{id: market}, []chainrpc.Log{creation, completed, completed}, curve
}

func TestBusinessObservationsDeduplicateAndPreserveBlockState(t *testing.T) {
	f, b, markets, logs, curve := businessFixture(t)
	before := f.reads
	batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, markets, logs)
	if err != nil {
		t.Fatal(err)
	}
	if batch.Expected != 2 || len(batch.Observations) != 2 || batch.BlockHash != b.Hash || batch.Scope != ObservationScope {
		t.Fatal(batch)
	}
	if batch.Observations[0].Kind != "market" || batch.Observations[1].Key != curve {
		t.Fatal(batch)
	}
	if batch.Observations[1].Value["quoteReserve"] != "115792089237316195423570985008687907853269984665640564039457584007913129639935" {
		t.Fatal("lost uint256 precision")
	}
	if f.reads-before != 19 {
		t.Fatalf("expected 19 state calls, got %d", f.reads-before)
	}
}

func TestBusinessObservationsRejectBadViewsAndReturnNoPartialBatch(t *testing.T) {
	for _, name := range []string{"missing getter", "bool padding", "address padding", "quote mismatch", "tax mismatch", "immutable market", "reverse", "block mismatch", "reorg", "unknown market", "curve market mismatch", "graduated regression"} {
		t.Run(name, func(t *testing.T) {
			f, b, markets, logs, curve := businessFixture(t)
			registry := f.manifest.Contracts[5].Address
			var id string
			for key := range markets {
				id = key
			}
			switch name {
			case "missing getter":
				delete(f.calls, curve+Hash([]byte("sweepNonce()"))[:10])
			case "bool padding":
				f.calls[curve+Hash([]byte("readyToGraduate()"))[:10]] = bytesWord("2")
			case "address padding":
				f.calls[curve+Hash([]byte("quoteAsset()"))[:10]][0] = 1
			case "quote mismatch":
				f.calls[curve+Hash([]byte("quoteAsset()"))[:10]] = addrWord(zero20)
			case "tax mismatch":
				f.calls[curve+Hash([]byte("creatorTaxBps()"))[:10]] = bytesWord("0")
			case "immutable market":
				data := append([]byte{}, f.calls[registry+Hash([]byte("market(bytes32)"))[:10]+id[2:]]...)
				copy(data[7*32:8*32], bytesWord("2"))
				f.calls[registry+Hash([]byte("market(bytes32)"))[:10]+id[2:]] = data
			case "reverse":
				token := markets[id].State["memeToken"].(string)
				f.calls[registry+Hash([]byte("marketIdByToken(address)"))[:10]+strings.Repeat("0", 24)+token[2:]] = bytesWord(zero32)
			case "block mismatch":
				logs[0].BlockHash = genesisHash
			case "reorg":
				f.finalReorg = true
			case "unknown market":
				delete(markets, id)
			case "curve market mismatch":
				logs[1].Topics[1] = wordHex("ff")
			case "graduated regression":
				markets[id].State["launchPhase"] = "1"
				markets[id].State["sourceVersion"] = "2"
				markets[id].State["poolId"] = wordHex("99")
			}
			batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, markets, logs)
			if err == nil || len(batch.Observations) != 0 || batch.Scope != "" {
				t.Fatalf("accepted bad batch: %+v %v", batch, err)
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatal("provider diagnostics leaked")
			}
		})
	}
}

func TestBusinessObservationMarketGraduationAndEmptyBlock(t *testing.T) {
	f, b, markets, logs, _ := businessFixture(t)
	var id string
	for key := range markets {
		id = key
	}
	registry := f.manifest.Contracts[5].Address
	key := registry + Hash([]byte("market(bytes32)"))[:10] + id[2:]
	data := append([]byte{}, f.calls[key]...)
	copy(data[17*32:], bytesWord("99"))
	copy(data[18*32:], bytesWord("2"))
	copy(data[19*32:], bytesWord("1"))
	f.calls[key] = data
	batch, err := ObserveBusinessBlock(context.Background(), f, f.manifest, b, markets, logs[:1])
	if err != nil {
		t.Fatal(err)
	}
	if batch.Observations[0].Value["launchPhase"] != "1" {
		t.Fatal(batch)
	}
	batch, err = ObserveBusinessBlock(context.Background(), f, f.manifest, b, markets, nil)
	if err != nil {
		t.Fatal(err)
	}
	if batch.Expected != 0 || batch.Observations == nil || len(batch.Observations) != 0 {
		t.Fatal(batch)
	}
	log := logs[0]
	log.Address = zero20
	batch, err = ObserveBusinessBlock(context.Background(), f, f.manifest, b, markets, []chainrpc.Log{log})
	if err != nil || batch.Expected != 0 {
		t.Fatal(batch, err)
	}
}

func TestDirectoryObservationsIncludeQuietMarkets(t *testing.T) {
	f, b, markets, _, curve := businessFixture(t)
	batch, err := ObserveDirectoryBlock(context.Background(), f, f.manifest, b, markets, nil)
	if err != nil {
		t.Fatal(err)
	}
	if batch.Expected != 2 || len(batch.Observations) != 2 || batch.Observations[0].Kind != "market" || batch.Observations[1].Kind != "curve" || batch.Observations[1].Key != curve {
		t.Fatal(batch)
	}
	f.headers = 0
	delete(f.calls, curve+Hash([]byte("realQuoteReserve()"))[:10])
	batch, err = ObserveDirectoryBlock(context.Background(), f, f.manifest, b, markets, nil)
	if err == nil || len(batch.Observations) != 0 {
		t.Fatal("quiet market missing getter accepted", batch, err)
	}
}

func TestDirectoryObservationsBoundBeforeRPC(t *testing.T) {
	markets := make(map[string]MarketDiscovery)
	for i := 0; i < 1001; i++ {
		markets[fmt.Sprint(i)] = MarketDiscovery{}
	}
	batch, err := ObserveDirectoryBlock(context.Background(), nil, Manifest{}, chainrpc.Header{}, markets, nil)
	if err == nil || len(batch.Observations) != 0 {
		t.Fatal("unbounded directory accepted")
	}
}
