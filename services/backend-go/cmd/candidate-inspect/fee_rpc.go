package main

import (
	"context"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func verifyCandidateFeeCoverage(ctx context.Context, rpc deployment.BindingObserver, m deployment.Manifest, c readmodel.CandidateSet) error {
	return readmodel.VerifyFeeCoverageRPC(ctx, rpc, m, c)
}
