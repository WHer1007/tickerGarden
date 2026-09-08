package settlement

import (
	"context"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestQuoteRejectsConflictingInputsBeforeRPC(t *testing.T) {
	for _, input := range []ObservedInput{
		{},
		{PoolManager: &deployment.ExternalRuntime{}, Quote: &Quote{}},
		{PoolManager: &deployment.ExternalRuntime{}, References: []SignedReference{{}}},
		{PoolManager: &deployment.ExternalRuntime{}, SlippageBps: -1},
		{PoolManager: &deployment.ExternalRuntime{}, SlippageBps: 101},
	} {
		got, err := QuoteConversion(context.Background(), noRouteRPC{}, deployment.Manifest{}, input)
		if err == nil || got.Quote.ExpectedOutput != "" {
			t.Fatalf("invalid input accepted: %+v %v", got, err)
		}
		checked, err := VerifyAutoConversion(context.Background(), noRouteRPC{}, deployment.Manifest{}, input, ReferencePolicy{})
		if err == nil || len(checked.Result()) != 0 {
			t.Fatal("invalid auto input accepted")
		}
	}
}
