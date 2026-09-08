package main

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
	"time"
)

type curveObserver struct {
	deployment.BindingObserver
	hash, address string
	calls         map[string][]byte
	empty         bool
}

func (f curveObserver) CodeAt(_ context.Context, a, h string) ([]byte, error) {
	if a != f.address || h != f.hash {
		return nil, errors.New("scope")
	}
	if f.empty {
		return nil, nil
	}
	return []byte{1}, nil
}
func (f curveObserver) CallAt(_ context.Context, a, data, h string) ([]byte, error) {
	if a != f.address || h != f.hash {
		return nil, errors.New("scope")
	}
	b, ok := f.calls[data]
	if !ok {
		return nil, errors.New("missing")
	}
	return b, nil
}
func TestCandidateCurveProgress(t *testing.T) {
	for _, mode := range []string{"valid", "reserve", "sellable", "reserved", "fees", "ready", "quote", "empty code", "missing", "dirty bool"} {
		t.Run(mode, func(t *testing.T) {
			hash := "0x" + strings.Repeat("1", 64)
			curve := "0x" + strings.Repeat("2", 40)
			quote := "0x" + strings.Repeat("3", 40)
			calls := map[string][]byte{}
			put := func(signature, word string) {
				raw, e := hex.DecodeString(word)
				if e != nil {
					t.Fatal(e)
				}
				calls[deployment.Hash([]byte(signature))[:10]] = raw
			}
			put("quoteAsset()", strings.Repeat("0", 24)+quote[2:])
			for signature, n := range map[string]int{"realQuoteReserve()": 100, "sellableTokens()": 200, "reservedTokens()": 300, "accruedCurveFees()": 4, "readyToGraduate()": 1} {
				put(signature, fmt.Sprintf("%064x", n))
			}
			p := readmodel.CurveProgress{RealQuoteReserve: "100", SellableTokens: "200", ReservedTokens: "300", AccruedCurveFees: "4", ReadyToGraduate: true}
			switch mode {
			case "reserve":
				p.RealQuoteReserve = "101"
			case "sellable":
				p.SellableTokens = "201"
			case "reserved":
				p.ReservedTokens = "301"
			case "fees":
				p.AccruedCurveFees = "5"
			case "ready":
				p.ReadyToGraduate = false
			case "quote":
				quote = curve
			case "missing":
				delete(calls, deployment.Hash([]byte("reservedTokens()"))[:10])
			case "dirty bool":
				put("readyToGraduate()", fmt.Sprintf("%064x", 2))
			}
			c := readmodel.CandidateSet{BlockHash: hash, Markets: []readmodel.MarketReadModel{{Curve: curve, QuoteAsset: quote, CurveProgress: p}}}
			f := curveObserver{hash: hash, address: curve, calls: calls, empty: mode == "empty code"}
			if e := verifyCandidateCurves(context.Background(), f, c); (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
			client, count := curveHTTPFixture(t, f)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if e := verifyCandidateCurves(ctx, client, c); (e == nil) != (mode == "valid") {
				t.Fatal("HTTP", mode, e)
			}
			if mode == "valid" && count.Load() != 7 {
				t.Fatal("missing Curve read", count.Load())
			}

		})
	}
}
