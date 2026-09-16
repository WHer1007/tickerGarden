package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"math/big"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/analytics"
)

// Reuse the analytics test's isolated chain, checkpoint and block observation.
func testPoolAnalytics(t *testing.T, ctx context.Context, pool *pgxpool.Pool, blockHash string) {
	t.Helper()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	put := func(table, key string, value any) {
		t.Helper()
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(4663,$1,$2,$3,$4) ON CONFLICT(chain_id,table_name,row_key) DO UPDATE SET payload=EXCLUDED.payload`, table, key, raw, blockHash)
	}
	a0, a1 := fmt.Sprintf("0x%040x", 70101), fmt.Sprintf("0x%040x", 70102)
	binding := analytics.PoolBinding{MarketID: hash(70103), PoolID: hash(70104), Currency0: a0, Currency1: a1, MemeAsset: a0, QuoteAsset: a1, QuoteDecimals: 18}
	source := analytics.CurveSource{ChainID: 4663, BlockNumber: "1", BlockHash: blockHash, TransactionHash: hash(70105), LogIndex: 100, Emitter: fmt.Sprintf("0x%040x", 70106)}
	source.EventKey = fmt.Sprintf("4663:%s:100", source.TransactionHash)
	feeSource := source
	feeSource.LogIndex = 101
	feeSource.Emitter = fmt.Sprintf("0x%040x", 70107)
	feeSource.EventKey = fmt.Sprintf("4663:%s:101", source.TransactionHash)
	types := []string{"address", "address", "uint24", "int24", "address"}
	var fields abi.Arguments
	for _, name := range types {
		typ, err := abi.NewType(name, "", nil)
		if err != nil {
			t.Fatal(err)
		}
		fields = append(fields, abi.Argument{Type: typ})
	}
	packed, err := fields.Pack(common.HexToAddress(a0), common.HexToAddress(a1), big.NewInt(0), big.NewInt(60), common.HexToAddress(feeSource.Emitter))
	if err != nil {
		t.Fatal(err)
	}
	binding.PoolID = crypto.Keccak256Hash(packed).Hex()
	configID := hash(70109)
	marketValues := map[string]any{"poolId": binding.PoolID, "memeToken": a0, "quoteAsset": a1, "quoteAssetConfigId": configID, "graduatedHook": feeSource.Emitter}
	poolValues := map[string]any{"currency0": a0, "currency1": a1, "fee": "0", "tickSpacing": "60", "hooks": feeSource.Emitter}
	quoteValues := map[string]any{"quoteAsset": a1, "quoteDecimals": "18"}
	putMarket := func() {
		put("markets", binding.MarketID, map[string]any{"marketId": binding.MarketID, "values": marketValues})
	}
	putPool := func() { put("pools", binding.MarketID, map[string]any{"key": binding.MarketID, "values": poolValues}) }
	putQuote := func() {
		put("configs", "quote:"+configID, map[string]any{"kind": "quote", "id": configID, "status": "2", "values": quoteValues})
	}
	putMarket()
	putPool()
	putQuote()
	args := map[string]any{"sender": fmt.Sprintf("0x%040x", 70111), "id": binding.PoolID, "amount0": "1000", "amount1": "-10000", "fee": "0"}
	feeID := hash(70108)
	feeArgs := map[string]any{"marketId": binding.MarketID, "poolId": binding.PoolID, "feeAsset": a0, "feeNonce": "1", "feeId": feeID, "base": "1000", "totalFee": "100", "lpAmount": "0", "nonLpAmount": "100"}
	swap := map[string]any{"eventKey": source.EventKey, "poolId": binding.PoolID, "values": args, "provenance": source, "hookFeeEventKey": feeSource.EventKey, "feeId": feeID}
	feeEvent := map[string]any{"provenance": feeSource, "signature": "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)", "args": feeArgs}
	put("events", source.EventKey, map[string]any{"provenance": source, "signature": "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)", "args": args})
	put("swaps", source.EventKey, swap)
	put("events", feeSource.EventKey, feeEvent)
	check := func(ok, hasFee bool) {
		t.Helper()
		got, err := analytics.LoadPoolObservation(ctx, pool, 4663, source.EventKey)
		if (err == nil) != ok {
			t.Fatalf("expected readable=%v: %+v %v", ok, got, err)
		}
		if !ok {
			return
		}
		if got.QuoteAsset != a1 || got.MemeToken != a0 || got.QuoteConfigID != configID || got.QuoteDecimals != 18 || got.MarketID != binding.MarketID || got.PoolID != binding.PoolID || got.Source != source || got.BlockTimestamp != "100" || got.Amounts.MemeCoreRaw != "1000" {
			t.Fatal(got)
		}
		if hasFee {
			if got.FeeSource == nil || *got.FeeSource != feeSource || got.Amounts.MemeCallerDelta == nil || *got.Amounts.MemeCallerDelta != "900" {
				t.Fatal(got)
			}
		} else if got.FeeSource != nil || got.Amounts.FeeRaw != nil || got.Amounts.MemeCallerDelta != nil {
			t.Fatal("missing fee presented as zero")
		}
	}
	check(true, true)
	for _, tc := range []struct {
		values map[string]any
		field  string
		bad    any
		save   func()
	}{
		{poolValues, "currency0", a1, putPool}, {poolValues, "tickSpacing", "61", putPool},
		{poolValues, "fee", "1", putPool}, {poolValues, "hooks", source.Emitter, putPool},
		{marketValues, "memeToken", a1, putMarket}, {marketValues, "quoteAssetConfigId", hash(1), putMarket},
		{marketValues, "graduatedHook", source.Emitter, putMarket}, {quoteValues, "quoteDecimals", "019", putQuote},
		{quoteValues, "quoteAsset", a0, putQuote},
	} {
		old := tc.values[tc.field]
		tc.values[tc.field] = tc.bad
		tc.save()
		check(false, false)
		tc.values[tc.field] = old
		tc.save()
		check(true, true)
	}
	duplicateMarket := hash(70110)
	put("markets", duplicateMarket, map[string]any{"marketId": duplicateMarket, "values": marketValues})
	put("pools", duplicateMarket, map[string]any{"key": duplicateMarket, "values": poolValues})
	check(false, false)
	exec(`DELETE FROM tickergarden.projection_rows WHERE chain_id=4663 AND table_name IN ('markets','pools') AND row_key=$1`, duplicateMarket)
	check(true, true)
	feeSource.Emitter = source.Emitter
	feeEvent["provenance"] = feeSource
	put("events", feeSource.EventKey, feeEvent)
	check(false, false)
	feeSource.Emitter = poolValues["hooks"].(string)
	feeEvent["provenance"] = feeSource
	put("events", feeSource.EventKey, feeEvent)
	check(true, true)
	exec(`DELETE FROM tickergarden.projection_rows WHERE chain_id=4663 AND table_name='events' AND row_key=$1`, feeSource.EventKey)
	check(false, false)
	put("events", feeSource.EventKey, feeEvent)
	check(true, true)
	duplicateKey := fmt.Sprintf("4663:%s:99", source.TransactionHash)
	put("swaps", duplicateKey, swap)
	check(false, false)
	exec(`DELETE FROM tickergarden.projection_rows WHERE chain_id=4663 AND table_name='swaps' AND row_key=$1`, duplicateKey)
	check(true, true)
	exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=4663`)
	check(false, false)
	exec(`UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=4663`)
	check(true, true)
	delete(swap, "hookFeeEventKey")
	delete(swap, "feeId")
	put("swaps", source.EventKey, swap)
	check(true, false)
	// No association means an otherwise present same-transaction fee is not guessed.
}
