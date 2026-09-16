package deployment

import (
	"context"
	"fmt"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

var userClaimModeV1 = Hash([]byte("TICKERGARDEN_USER_CLAIM_ASSET_SELECTION_V1"))

// Verify the current immutable claim mode at the pinned observation block.
func feeVaultUsesUserClaims(ctx context.Context, rpc BindingObserver, vault string, block chainrpc.Header) (bool, error) {
	raw, err := rpc.CallAt(ctx, vault, Hash([]byte("userClaimMode()"))[:10], block.Hash)
	if err != nil {
		return false, fmt.Errorf("FeeVault user claim mode unavailable: %w", err)
	}
	value, err := events.DecodeStatic([]events.Input{{Name: "mode", Type: "bytes32"}}, raw)
	if err != nil {
		return false, fmt.Errorf("invalid FeeVault user claim mode: %w", err)
	}
	mode, ok := value["mode"].(string)
	if !ok || mode != userClaimModeV1 {
		return false, fmt.Errorf("unknown FeeVault user claim mode")
	}
	return true, nil
}
