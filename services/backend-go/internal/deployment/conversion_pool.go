package deployment

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
)

// ConversionPoolState uses the pinned v4 StateLibrary layout. Liquidity is the
// current active range value, not an executable depth or independent price.
type ConversionPoolState struct {
	StateSlot       string `json:"stateSlot"`
	SqrtPriceX96    string `json:"sqrtPriceX96"`
	Tick            int32  `json:"tick"`
	ProtocolFee     uint32 `json:"protocolFee"`
	LPFee           uint32 `json:"lpFee"`
	ActiveLiquidity string `json:"activeLiquidity"`
}

var errConversionPool = errors.New("reward conversion pool state unavailable or inconsistent")

func observeConversionPool(ctx context.Context, rpc BindingObserver, manager, pool, blockHash string) (ConversionPoolState, error) {
	// StateLibrary.POOLS_SLOT=6; liquidity is Pool.State slot +3.
	raw, e := hex.DecodeString(pool[2:] + fmt.Sprintf("%064x", 6))
	if e != nil {
		return ConversionPoolState{}, errConversionPool
	}
	slot := Hash(raw)
	position, _ := new(big.Int).SetString(slot[2:], 16)
	position.Add(position, big.NewInt(3))
	if position.BitLen() > 256 {
		return ConversionPoolState{}, errConversionPool
	}
	read := func(key string) ([]byte, error) {
		return rpc.CallAt(ctx, manager, Hash([]byte("extsload(bytes32)"))[:10]+key, blockHash)
	}
	packed, e := read(slot[2:])
	if e != nil {
		return ConversionPoolState{}, errConversionPool
	}
	liquidity, e := read(fmt.Sprintf("%064x", position))
	if e != nil {
		return ConversionPoolState{}, errConversionPool
	}
	state, e := decodeConversionPool(packed, liquidity)
	if e != nil {
		return ConversionPoolState{}, e
	}
	state.StateSlot = slot
	return state, nil
}

func decodeConversionPool(packed, liquidity []byte) (ConversionPoolState, error) {
	fail := func() (ConversionPoolState, error) { return ConversionPoolState{}, errConversionPool }
	if len(packed) != 32 || len(liquidity) != 32 {
		return fail()
	}
	for _, b := range packed[:3] {
		if b != 0 {
			return fail()
		}
	}
	for _, b := range liquidity[:16] {
		if b != 0 {
			return fail()
		}
	}
	price := new(big.Int).SetBytes(packed[12:])
	min, _ := new(big.Int).SetString("4295128739", 10)
	max, _ := new(big.Int).SetString("1461446703485210103287273052203988822378723970342", 10)
	if price.Cmp(min) < 0 || price.Cmp(max) >= 0 {
		return fail()
	}
	uint24 := func(b []byte) uint32 { return uint32(b[0])<<16 | uint32(b[1])<<8 | uint32(b[2]) }
	tick := int32(uint24(packed[9:12]))
	if tick&0x800000 != 0 {
		tick -= 1 << 24
	}
	if tick < -887272 || tick > 887272 {
		return fail()
	}
	protocol, lp := uint24(packed[6:9]), uint24(packed[3:6])
	// Accept the pinned v4 directional protocol-fee range. LP fees remain disabled.
	// A successful simulation is still required: older immutable Hooks reject protocol fees.
	if protocol&0xfff > 1000 || protocol>>12 > 1000 || lp != 0 {
		return fail()
	}
	return ConversionPoolState{SqrtPriceX96: price.String(), Tick: tick, ProtocolFee: protocol, LPFee: lp, ActiveLiquidity: new(big.Int).SetBytes(liquidity).String()}, nil
}
