package settlement

import (
	"context"
	"testing"
	"tickergarden/backend/internal/deployment"
)

// An embedded nil interface panics on any RPC use: missing trust configuration
// must fail before observation or simulation, never fall back to old behavior.
type noRouteRPC struct{ ConversionPreviewObserver }

func TestPreviewRequiresExplicitPoolManagerBeforeRPC(t *testing.T) {
	got, e := PreviewConversion(context.Background(), noRouteRPC{}, deployment.Manifest{}, ObservedInput{})
	if e != ErrSimulation || got.Data != "" || got.Allocations != nil {
		t.Fatalf("missing route pin was accepted: %+v %v", got, e)
	}
}
