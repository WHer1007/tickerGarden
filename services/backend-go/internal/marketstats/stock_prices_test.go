package marketstats

import (
	"context"
	"encoding/hex"
	"math/big"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/displayprice"
	"time"
)

type stockRPC struct {
	rpcFixture
	calls          int
	token0, token1 string
	mismatch       bool
}

func (r *stockRPC) CallAt(_ context.Context, _ string, data, _ string) ([]byte, error) {
	r.calls++
	out := make([]byte, 32)
	for method, address := range map[string]string{"token0()": r.token0, "token1()": r.token1} {
		if data == deployment.Hash([]byte(method))[:10] {
			raw, _ := hex.DecodeString(address[2:])
			copy(out[12:], raw)
			if r.mismatch {
				out[31] ^= 1
			}
			return out, nil
		}
	}
	raw := make([]byte, 224)
	new(big.Int).Lsh(big.NewInt(1), 96).FillBytes(raw[:32])
	return raw, nil
}
func TestStockPoolPriceSharedCachedAndBound(t *testing.T) {
	now := time.Now()
	native := ref(46630, zero, "2000", "2000", now, now.Add(time.Hour))
	token, eth := "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"
	for _, bad := range []bool{false, true} {
		rpc := &stockRPC{token0: token, token1: eth, mismatch: bad}
		p := NewPrices(46630, nil)
		p.native = &native
		p.stockRPC = rpc
		p.stockRoutes = map[string]stockRoute{token: {TokenOut: token, TokenIn: eth, Pool: token, Decimals: 18}}
		p.stockRefs = map[string]displayprice.Reference{}
		p.stockAttempts = map[string]time.Time{}
		p.RefreshStocks(context.Background(), []string{token, token}, chainrpc.Header{})
		if bad {
			if len(p.stockRefs) != 0 {
				t.Fatal("accepted wrong pool")
			}
			continue
		}
		if rpc.calls != 3 || *p.stockRefs[token].BidUSD != "2000.000000000000000000" {
			t.Fatalf("price/calls: %v %d", p.stockRefs, rpc.calls)
		}
		p.RefreshStocks(context.Background(), []string{token}, chainrpc.Header{})
		if rpc.calls != 3 {
			t.Fatal("repeated cached read")
		}
	}
}
