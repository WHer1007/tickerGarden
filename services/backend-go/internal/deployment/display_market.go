package deployment

import (
	"context"
	"errors"
	"strings"
	"tickergarden/backend/internal/events"
)

// ReadDisplayMarket uses the already configured registry, without repeating
// deployment verification. This observation cannot be used for settlement.
func ReadDisplayMarket(ctx context.Context, rpc interface {
	CallAt(context.Context, string, string, string) ([]byte, error)
}, registry, id, hash string) (map[string]any, error) {
	if !hex32.MatchString(id) || id == zero32 {
		return nil, errors.New("invalid market")
	}
	raw, err := rpc.CallAt(ctx, registry, Hash([]byte("market(bytes32)"))[:10]+id[2:], hash)
	if err != nil {
		return nil, err
	}
	state, err := events.DecodeStatic(marketFields, raw)
	if err != nil {
		return nil, err
	}
	if err = validateMarketState(state); err != nil {
		return nil, err
	}
	token := state["memeToken"].(string)
	raw, err = rpc.CallAt(ctx, registry, Hash([]byte("marketIdByToken(address)"))[:10]+strings.Repeat("0", 24)+token[2:], hash)
	if err != nil {
		return nil, err
	}
	reverse, err := events.DecodeStatic([]events.Input{{Name: "id", Type: "bytes32"}}, raw)
	if err != nil || reverse["id"] != id {
		return nil, errors.New("market identity mismatch")
	}
	return state, nil
}
