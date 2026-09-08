package settlement

import (
	"context"
	"encoding/json"
	"tickergarden/backend/internal/deployment"
	"time"
)

// VerifiedConversion has no public constructor or mutable payload. Only a live
// conversion check can produce a value eligible for audit persistence.
// It never authorizes signing, and its observations expire normally.
type VerifiedConversion struct {
	payload                         []byte
	manifest                        []byte
	chainID                         uint64
	genesis, market, request, block string
}

func (v VerifiedConversion) Result() json.RawMessage {
	return append(json.RawMessage(nil), v.payload...)
}

func VerifyConversion(ctx context.Context, rpc ConversionPreviewObserver, manifest deployment.Manifest, input ObservedInput, policy ReferencePolicy, fetch bool) (VerifiedConversion, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if fetch && len(input.References) != 0 {
		return VerifiedConversion{}, ErrReference
	}
	preview, err := PreviewConversion(ctx, rpc, manifest, input)
	if err != nil {
		return VerifiedConversion{}, err
	}
	var checked ReferenceCheck
	if fetch {
		checked, err = FetchReferences(ctx, preview, policy)
	} else {
		checked, err = CheckReferences(preview, policy, input.References, time.Now().Unix())
	}
	if err != nil {
		return VerifiedConversion{}, err
	}
	header, err := rpc.Header(ctx, preview.Candidate.State.Block.Number)
	now := time.Now().Unix()
	if err != nil || header != preview.Candidate.State.Block || input.Quote == nil || now-input.Quote.QuotedAt > 30 || input.Quote.QuotedAt > now || now > preview.Candidate.Plan.Deadline {
		return VerifiedConversion{}, ErrReference
	}
	payload, err := json.Marshal(map[string]any{"preview": preview, "referenceCheck": checked, "referencesFetched": fetch, "referenceSignaturesVerified": true, "simulationPriceWithinPolicy": true, "providerIndependenceVerified": false, "executionComplete": false, "transactionSubmission": false})
	if err != nil {
		return VerifiedConversion{}, err
	}
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		return VerifiedConversion{}, err
	}
	return VerifiedConversion{manifest: manifestBytes, payload: payload, chainID: policy.ChainID, genesis: policy.GenesisHash, market: policy.MarketID, request: preview.Candidate.Request.RequestDigest, block: header.Hash}, nil
}
