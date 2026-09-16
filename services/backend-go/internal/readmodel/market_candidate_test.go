package readmodel

import (
	"os"
	"reflect"
	"strconv"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func candidateFixture(t *testing.T, pool bool) (deployment.ObservationBatch, MarketReadModel) {
	t.Helper()
	raw, e := os.ReadFile("testdata/snapshot.json")
	if e != nil {
		t.Fatal(e)
	}
	s, e := Parse(raw, 46630)
	if e != nil {
		t.Fatal(e)
	}
	m := s.Markets[0]
	if pool {
		m.LaunchPhase = 1
		m.CanonicalRoute.LaunchPhase = 1
		m.CanonicalRoute.CurveTradingEnabled = false
		m.CanonicalRoute.PoolTradingEnabled = true
		id := "0x0000000000000000000000000000000000000000000000000000000000000001"
		m.PoolID = &id
		m.PoolKey = &PoolKeyReadModel{Currency0: m.QuoteAsset, Currency1: m.MemeToken, Fee: 3000, TickSpacing: 60, Hooks: m.CanonicalRoute.Hook}
	}
	market := map[string]any{"creatorFeesToHolders": false, "assetUid": m.AssetUID, "memeToken": m.MemeToken, "curve": m.Curve, "gauge": m.Gauge, "quoteAsset": m.QuoteAsset, "quoteAssetConfigId": m.QuoteAssetConfigID, "tickerGardenBaselineId": m.TickerGardenBaselineID, "sourceVersion": "1", "launchPhase": strconv.FormatUint(m.LaunchPhase, 10), "creatorTaxBps": "0", "graduatedHook": m.CanonicalRoute.Hook}
	curve := map[string]any{"marketId": m.MarketID, "quoteAsset": m.QuoteAsset, "creatorTaxBps": "0", "realQuoteReserve": m.CurveProgress.RealQuoteReserve, "sellableTokens": m.CurveProgress.SellableTokens, "reservedTokens": m.CurveProgress.ReservedTokens, "accruedCurveFees": m.CurveProgress.AccruedCurveFees, "readyToGraduate": m.CurveProgress.ReadyToGraduate}
	route := map[string]any{"swapRouter": m.CanonicalRoute.Router, "quoter": m.CanonicalRoute.Quoter, "hook": m.CanonicalRoute.Hook, "launchLocker": m.CanonicalRoute.LaunchLocker, "graduationExecutor": m.CanonicalRoute.GraduationExecutor, "curveTradingEnabled": m.CanonicalRoute.CurveTradingEnabled, "poolTradingEnabled": m.CanonicalRoute.PoolTradingEnabled}
	for _, f := range []string{"memeToken", "quoteAsset", "curve", "gauge", "sourceVersion", "launchPhase"} {
		route[f] = market[f]
	}
	key := map[string]any{}
	if pool {
		market["poolId"] = *m.PoolID
		route["poolId"] = *m.PoolID
		key = map[string]any{"currency0": m.PoolKey.Currency0, "currency1": m.PoolKey.Currency1, "fee": "3000", "tickSpacing": "60", "hooks": m.PoolKey.Hooks}
		for f, v := range key {
			route[f] = v
		}
	}
	runtime := map[string]any{"swapRouter": *s.Sync.BlockHash, "quoter": *s.Sync.BlockHash, "graduationExecutor": *s.Sync.BlockHash}
	return deployment.ObservationBatch{ChainID: 46630, BlockNumber: "0x1", BlockHash: *s.Sync.BlockHash, Expected: 5, Observations: []deployment.StateObservation{{Kind: "market", Key: m.MarketID, Value: market}, {Kind: "curve", Key: m.Curve, Value: curve}, {Kind: "canonicalRoute", Key: m.MarketID, Value: route}, {Kind: "poolKey", Key: m.MarketID, Value: key}, {Kind: "routeRuntime", Key: m.MarketID, Value: runtime}}}, m
}
func TestBuildMarketCandidate(t *testing.T) {
	for _, pool := range []bool{false, true} {
		batch, want := candidateFixture(t, pool)
		got, e := BuildMarketCandidate(batch, want.MarketID, want.Source)
		if e != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("pool=%v: %v %+v", pool, e, got)
		}
		batch.Observations[1].Value["realQuoteReserve"] = "0"
		if got.CurveProgress.RealQuoteReserve != want.CurveProgress.RealQuoteReserve {
			t.Fatal("output shares input")
		}
	}
}
func TestBuildMarketCandidateRejectsIncompleteAndContradictory(t *testing.T) {
	for _, kind := range []string{"count", "duplicate", "chain", "future source", "source hash", "missing fee", "wrong quote", "version overflow", "wrong route", "invalid object", "missing executor", "pool currencies", "tick overflow"} {
		t.Run(kind, func(t *testing.T) {
			b, m := candidateFixture(t, true)
			switch kind {
			case "count":
				b.Expected++
			case "duplicate":
				b.Observations = append(b.Observations, b.Observations[0])
				b.Expected++
			case "chain":
				b.ChainID++
			case "source hash":
				b.BlockHash = "0x0000000000000000000000000000000000000000000000000000000000000001"
			case "future source":
				m.Source.BlockNumber = "2"
			case "missing fee":
				delete(b.Observations[1].Value, "accruedCurveFees")
			case "wrong quote":
				b.Observations[1].Value["quoteAsset"] = m.MemeToken
			case "version overflow":
				b.Observations[0].Value["sourceVersion"] = "4294967296"
				b.Observations[2].Value["sourceVersion"] = "4294967296"
			case "wrong route":
				b.Observations[2].Value["poolTradingEnabled"] = false
			case "invalid object":
				b.Observations[0].Value["gauge"] = map[string]any{}
			case "missing executor":
				delete(b.Observations[2].Value, "graduationExecutor")
			case "pool currencies":
				b.Observations[3].Value["currency0"] = m.MemeToken
			case "tick overflow":
				b.Observations[3].Value["tickSpacing"] = "8388608"
			}
			got, e := BuildMarketCandidate(b, m.MarketID, m.Source)
			if e == nil || !reflect.DeepEqual(got, MarketReadModel{}) {
				t.Fatal("invalid candidate accepted", got, e)
			}
		})
	}
}
