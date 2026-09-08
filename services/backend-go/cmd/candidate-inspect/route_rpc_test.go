package main

import (
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func TestCandidateRouteFields(t *testing.T) {
	for _, mode := range []string{"valid", "router", "version", "missing", "duplicate", "pool", "pool mismatch"} {
		t.Run(mode, func(t *testing.T) {
			m := readmodel.MarketReadModel{MarketID: "id", MemeToken: "token", QuoteAsset: "quote", Curve: "curve", Gauge: "gauge", SourceVersion: 1, CanonicalRoute: readmodel.CanonicalRoute{Router: "router", Quoter: "quoter", Hook: "hook", LaunchLocker: "locker", GraduationExecutor: "executor", CurveTradingEnabled: true, SourceVersion: 1}}
			route := map[string]any{"memeToken": "token", "quoteAsset": "quote", "curve": "curve", "gauge": "gauge", "swapRouter": "router", "quoter": "quoter", "hook": "hook", "launchLocker": "locker", "graduationExecutor": "executor", "curveTradingEnabled": true, "poolTradingEnabled": false, "sourceVersion": "1", "launchPhase": "0"}
			pool := map[string]any{}
			if mode == "pool" || mode == "pool mismatch" {
				id := "pool"
				m.PoolID = &id
				m.PoolKey = &readmodel.PoolKeyReadModel{Currency0: "quote", Currency1: "token", TickSpacing: 60, Hooks: "hook"}
				m.LaunchPhase = 1
				m.CanonicalRoute.LaunchPhase = 1
				m.CanonicalRoute.CurveTradingEnabled = false
				m.CanonicalRoute.PoolTradingEnabled = true
				route["launchPhase"] = "1"
				route["curveTradingEnabled"] = false
				route["poolTradingEnabled"] = true
				route["poolId"] = "pool"
				pool = map[string]any{"currency0": "quote", "currency1": "token", "fee": "0", "tickSpacing": "60", "hooks": "hook"}
			}
			b := deployment.ObservationBatch{Scope: "market-route-v1", Expected: 2, Observations: []deployment.StateObservation{{Kind: "canonicalRoute", Key: "id", Value: route}, {Kind: "poolKey", Key: "id", Value: pool}}}
			switch mode {
			case "router":
				route["swapRouter"] = "wrong"
			case "version":
				route["sourceVersion"] = "2"
			case "missing":
				b.Observations = b.Observations[1:]
				b.Expected = 1
			case "duplicate":
				b.Observations = append(b.Observations, b.Observations[0])
				b.Expected++
			case "pool mismatch":
				pool["tickSpacing"] = "61"
			}
			if e := matchCandidateRoute(m, b); (e == nil) != (mode == "valid" || mode == "pool") {
				t.Fatal(mode, e)
			}
		})
	}
}
