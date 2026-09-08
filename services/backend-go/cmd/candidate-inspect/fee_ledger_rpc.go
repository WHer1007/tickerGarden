package main

import (
	"context"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func verifyCandidateFeeLedgerRPC(ctx context.Context, rpc deployment.BindingObserver, m deployment.Manifest, c readmodel.CandidateSet) error {
	return readmodel.VerifyFeeLedgerRPC(ctx, rpc, m, c)
}
