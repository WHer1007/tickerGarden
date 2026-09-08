package integration

import (
	"context"
	"fmt"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type aheadFinalizedRPC struct{ deployment.BindingObserver }

func (r aheadFinalizedRPC) Header(ctx context.Context, tag string) (chainrpc.Header, error) {
	h, err := r.BindingObserver.Header(ctx, tag)
	if err != nil || tag != "finalized" {
		return h, err
	}
	n, err := h.Height()
	if err != nil {
		return h, err
	}
	h.ParentHash = h.Hash
	h.Number = fmt.Sprintf("0x%x", n+1)
	h.Hash = deployment.Hash([]byte("next finalized head not yet ingested"))
	return h, nil
}
