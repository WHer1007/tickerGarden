package deployment

import (
	"math/big"
	"testing"
)

func conversionPoolFixture(tick int32, price, liquidity string) ([]byte, []byte) {
	packed := make([]byte, 32)
	packed[9] = byte(uint32(tick) >> 16)
	packed[10] = byte(uint32(tick) >> 8)
	packed[11] = byte(tick)
	priceInt, ok := new(big.Int).SetString(price, 10)
	if !ok {
		panic("invalid price fixture")
	}
	priceInt.FillBytes(packed[12:])
	liquidityBytes := make([]byte, 32)
	liquidityInt, ok := new(big.Int).SetString(liquidity, 10)
	if !ok {
		panic("invalid liquidity fixture")
	}
	liquidityInt.FillBytes(liquidityBytes)
	return packed, liquidityBytes
}

func TestDecodeConversionPoolAcceptsValidPackedState(t *testing.T) {
	maxUint128 := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 128), big.NewInt(1)).String()
	tests := []struct {
		name      string
		tick      int32
		liquidity string
	}{
		{name: "q96 tick zero liquidity max", tick: 0, liquidity: maxUint128},
		{name: "negative signed tick liquidity zero", tick: -1, liquidity: "0"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			packed, liquidity := conversionPoolFixture(tt.tick, "79228162514264337593543950336", tt.liquidity)
			state, err := decodeConversionPool(packed, liquidity)
			if err != nil {
				t.Fatalf("decodeConversionPool() error = %v", err)
			}
			if state.SqrtPriceX96 != "79228162514264337593543950336" || state.Tick != tt.tick || state.ActiveLiquidity != tt.liquidity {
				t.Fatalf("decoded state = %+v", state)
			}
		})
	}
}

func TestDecodeConversionPoolRejectsInvalidPackedState(t *testing.T) {
	minPrice := "4295128739"
	maxPrice := "1461446703485210103287273052203988822378723970342"
	tests := []struct {
		name   string
		mutate func([]byte, []byte)
	}{
		{name: "zero for one fee too large", mutate: func(p, _ []byte) { p[7], p[8] = 3, 233 }},
		{name: "one for zero fee too large", mutate: func(p, _ []byte) { p[6], p[7] = 62, 144 }},
		{name: "fee bits nonzero", mutate: func(p, _ []byte) { p[3] = 1 }},
		{name: "packed short", mutate: func(p, l []byte) { _ = p; _ = l }},
		{name: "packed high padding", mutate: func(p, _ []byte) { p[0] = 1 }},
		{name: "liquidity high padding", mutate: func(_, l []byte) { l[0] = 1 }},
		{name: "minimum sqrt below allowed", mutate: func(p, _ []byte) { new(big.Int).Sub(new(big.Int).SetBytes(p[12:]), big.NewInt(1)).FillBytes(p[12:]) }},
		{name: "maximum sqrt excluded", mutate: func(p, _ []byte) { max, _ := new(big.Int).SetString(maxPrice, 10); max.FillBytes(p[12:]) }},
		{name: "tick below minimum", mutate: func(p, _ []byte) { p[9], p[10], p[11] = 0xf2, 0x76, 0x17 }},
		{name: "tick above maximum", mutate: func(p, _ []byte) { p[9], p[10], p[11] = 0x0d, 0x89, 0xe9 }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			packed, liquidity := conversionPoolFixture(0, minPrice, "0")
			if tt.name == "packed short" {
				packed = packed[:31]
			} else {
				tt.mutate(packed, liquidity)
			}
			if _, err := decodeConversionPool(packed, liquidity); err == nil {
				t.Fatal("decodeConversionPool() unexpectedly succeeded")
			}
		})
	}
}

func TestConversionPoolExactMinimumAndLengths(t *testing.T) {
	p, l := conversionPoolFixture(-887272, "4295128739", "0")
	if _, e := decodeConversionPool(p, l); e != nil {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{nil, l[:31], append(append([]byte{}, l...), 0)} {
		if _, e := decodeConversionPool(p, bad); e == nil {
			t.Fatal("invalid liquidity ABI accepted")
		}
	}
	if _, e := decodeConversionPool(append(append([]byte{}, p...), 0), l); e == nil {
		t.Fatal("trailing slot0 accepted")
	}
}

func TestDecodeConversionPoolDirectionalFees(t *testing.T) {
	for _, fee := range []uint32{0, 1, 1000, 1000 << 12, 1000 | 500<<12} {
		p, l := conversionPoolFixture(0, "79228162514264337593543950336", "1000")
		p[6], p[7], p[8] = byte(fee>>16), byte(fee>>8), byte(fee)
		got, err := decodeConversionPool(p, l)
		if err != nil || got.ProtocolFee != fee || got.LPFee != 0 {
			t.Fatalf("fee %d: %+v %v", fee, got, err)
		}
	}
}
