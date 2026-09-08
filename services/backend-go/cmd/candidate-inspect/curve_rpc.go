package main

import (
	"context"
	"errors"
	"reflect"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/readmodel"
)

// Called after Registry-backed route verification binds each Curve address.
func verifyCandidateCurves(ctx context.Context, rpc deployment.BindingObserver, c readmodel.CandidateSet) error {
	bad := errors.New("candidate Curve progress RPC mismatch")
	if len(c.Markets) > 1000 {
		return bad
	}
	seen := map[string]bool{}
	for _, m := range c.Markets {
		if seen[m.Curve] {
			return bad
		}
		seen[m.Curve] = true
		code, e := rpc.CodeAt(ctx, m.Curve, c.BlockHash)
		if e != nil || len(code) == 0 {
			return bad
		}
		p := m.CurveProgress
		for _, field := range []struct {
			signature, typ string
			want           any
		}{
			{"quoteAsset()", "address", m.QuoteAsset},
			{"realQuoteReserve()", "uint256", p.RealQuoteReserve},
			{"sellableTokens()", "uint256", p.SellableTokens},
			{"reservedTokens()", "uint256", p.ReservedTokens},
			{"accruedCurveFees()", "uint256", p.AccruedCurveFees},
			{"readyToGraduate()", "bool", p.ReadyToGraduate},
		} {
			raw, e := rpc.CallAt(ctx, m.Curve, deployment.Hash([]byte(field.signature))[:10], c.BlockHash)
			if e != nil {
				return bad
			}
			values, e := events.DecodeStatic([]events.Input{{Name: "value", Type: field.typ}}, raw)
			if e != nil || !reflect.DeepEqual(values["value"], field.want) {
				return bad
			}
		}
	}
	return nil
}
