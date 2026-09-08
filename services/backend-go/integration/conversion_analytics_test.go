package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"encoding/hex"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/analytics"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

func testConversionAnalytics(t *testing.T, ctx context.Context, pool *pgxpool.Pool, block string) {
	t.Helper()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	raw := func(v any) []byte {
		b, e := json.Marshal(v)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	address := func(n int) string { return fmt.Sprintf("0x%040x", n) }
	b := analytics.ConversionBinding{Pool: analytics.PoolBinding{MarketID: hash(71001), PoolID: hash(71002), Currency0: address(1), Currency1: address(2), MemeAsset: address(1), QuoteAsset: address(2), QuoteDecimals: 18}, Hook: address(3), FeeVault: address(4), PoolManager: address(5)}
	word := func(n int64) string {
		x := big.NewInt(n)
		if n < 0 {
			x.Add(x, new(big.Int).Lsh(big.NewInt(1), 256))
		}
		return fmt.Sprintf("%064x", x)
	}
	packed, _ := hex.DecodeString(word(1) + word(2) + word(0) + word(1) + word(3))
	b.Pool.PoolID = crypto.Keccak256Hash(packed).Hex()
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 4663, GenesisHash: block, Contracts: []deployment.Contract{{Module: "ProtocolFeeVault", Address: b.FeeVault, RuntimeCodeHash: hash(71010)}, {Module: "UniswapV4PoolManager", Address: b.PoolManager, RuntimeCodeHash: hash(71011)}}}
	commitment := deployment.Hash(raw(manifest))
	exec(`UPDATE tickergarden.projection_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, commitment)
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, commitment)
	defer func() {
		exec(`UPDATE tickergarden.projection_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, block)
		exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, block)
	}()
	configID := hash(71012)
	put := func(table, key string, value any) {
		exec(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES(4663,$1,$2,$3,$4) ON CONFLICT(chain_id,table_name,row_key) DO UPDATE SET payload=EXCLUDED.payload`, table, key, raw(value), block)
	}
	put("markets", b.Pool.MarketID, map[string]any{"marketId": b.Pool.MarketID, "values": map[string]any{"poolId": b.Pool.PoolID, "memeToken": b.Pool.MemeAsset, "quoteAsset": b.Pool.QuoteAsset, "quoteAssetConfigId": configID, "graduatedHook": b.Hook, "curve": address(6)}})
	keyRow := map[string]any{"key": b.Pool.MarketID, "values": map[string]any{"currency0": b.Pool.Currency0, "currency1": b.Pool.Currency1, "fee": "0", "tickSpacing": "1", "hooks": b.Hook}}
	put("pools", b.Pool.MarketID, keyRow)
	quoteRow := map[string]any{"kind": "quote", "id": configID, "status": "2", "values": map[string]any{"quoteAsset": b.Pool.QuoteAsset, "quoteDecimals": "18"}}
	put("configs", "quote:"+configID, quoteRow)
	topic := func(sig string) string { return crypto.Keccak256Hash([]byte(sig)).Hex() }
	transaction := hash(71003)
	swap := chainrpc.Log{Address: b.PoolManager, Topics: []string{topic("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"), b.Pool.PoolID, "0x" + strings.Repeat("0", 24) + b.Hook[2:]}, Data: "0x" + word(-1000) + word(10000) + word(1) + word(1) + word(0) + word(0), BlockNumber: "0x1", BlockHash: block, TransactionHash: transaction, TransactionIndex: "0x0", LogIndex: "0xc8"}
	summary := swap
	summary.Address = b.FeeVault
	summary.LogIndex = "0xc9"
	summary.Topics = []string{topic("RewardBatchConverted(bytes32,uint256,address,address,uint256,uint256)"), b.Pool.MarketID, "0x" + word(1)}
	summary.Data = "0x" + word(1) + word(2) + word(1000) + word(10000)
	receipt := chainrpc.Receipt{TransactionHash: transaction, TransactionIndex: "0x0", BlockHash: block, BlockNumber: "0x1", Status: "0x1", Logs: []chainrpc.Log{swap, summary}}
	exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES(4663,$1,$2,0,'0x1',$3)`, block, transaction, raw(receipt))
	defer func() {
		exec(`DELETE FROM tickergarden.projection_inputs WHERE chain_id=4663 AND block_hash=$1 AND log_index IN (200,201)`, block)
		exec(`DELETE FROM tickergarden.chain_logs WHERE chain_id=4663 AND block_hash=$1 AND log_index IN (200,201)`, block)
		exec(`DELETE FROM tickergarden.chain_receipts WHERE chain_id=4663 AND transaction_hash=$1`, transaction)
	}()
	insert := func(index int, l chainrpc.Log, module string) {
		exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES(4663,$1,$2,$3,$4) ON CONFLICT DO NOTHING`, block, index, l.Address, raw(l))
		data := raw(projection.Input{ChainID: 4663, Module: module, Log: l})
		exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES(4663,$1,$2,$3,$4) ON CONFLICT(chain_id,block_hash,log_index) DO UPDATE SET payload=EXCLUDED.payload,digest=EXCLUDED.digest`, block, index, data, crypto.Keccak256Hash(data).Hex())
	}
	insert(200, swap, "UniswapV4PoolManager")
	insert(201, summary, "ProtocolFeeVault")
	for i, log := range []chainrpc.Log{swap, summary} {
		module := "UniswapV4PoolManager"
		if i == 1 {
			module = "ProtocolFeeVault"
		}
		decoded, err := events.Decode(module, log)
		if err != nil {
			t.Fatal(err)
		}
		source := analytics.CurveSource{ChainID: 4663, BlockNumber: "1", BlockHash: block, TransactionHash: transaction, LogIndex: uint64(200 + i), Emitter: log.Address, EventKey: fmt.Sprintf("4663:%s:%d", transaction, 200+i)}
		put("events", source.EventKey, map[string]any{"provenance": source, "signature": decoded.Signature, "args": decoded.Args})
		if i == 0 {
			put("swaps", source.EventKey, map[string]any{"eventKey": source.EventKey, "poolId": b.Pool.PoolID, "provenance": source, "values": decoded.Args})
		}
	}

	check := func(ok bool) {
		t.Helper()
		got, err := analytics.LoadConversionLinks(ctx, pool, manifest, transaction)
		if (err == nil) != ok {
			t.Fatalf("readable=%v got=%+v err=%v", ok, got, err)
		}
		if ok && (len(got) != 1 || got[0].Activity.MemeSpentRaw != "1000" || got[0].SwapSource.LogIndex != 200 || got[0].SummarySource.LogIndex != 201) {
			t.Fatal(got)
		}
	}
	check(true)
	testAnalyticsCoverage(t, ctx, pool, manifest, block)
	exec(`UPDATE tickergarden.projection_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, hash(0))
	check(false)
	exec(`UPDATE tickergarden.projection_checkpoints SET manifest_hash=$1 WHERE chain_id=4663`, commitment)
	check(true)
	exec(`DELETE FROM tickergarden.projection_rows WHERE chain_id=4663 AND table_name='pools' AND row_key=$1`, b.Pool.MarketID)
	check(false)
	put("pools", b.Pool.MarketID, keyRow)
	check(true)
	quoteRow["values"].(map[string]any)["quoteDecimals"] = "19"
	put("configs", "quote:"+configID, quoteRow)
	check(false)
	quoteRow["values"].(map[string]any)["quoteDecimals"] = "18"
	put("configs", "quote:"+configID, quoteRow)
	check(true)
	exec(`DELETE FROM tickergarden.projection_inputs WHERE chain_id=4663 AND block_hash=$1 AND log_index=200`, block)
	check(false)
	insert(200, swap, "UniswapV4PoolManager")
	check(true)
	exec(`UPDATE tickergarden.projection_inputs SET digest=$2 WHERE chain_id=4663 AND block_hash=$1 AND log_index=200`, block, hash(0))
	check(false)
	insert(200, swap, "UniswapV4PoolManager")
	altered := swap
	altered.Data = "0x" + word(-999) + word(10000) + word(1) + word(1) + word(0) + word(0)
	insert(200, altered, "UniswapV4PoolManager")
	check(false)
	insert(200, swap, "UniswapV4PoolManager")
	exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=4663 AND hash=$1`, block)
	check(false)
	exec(`UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=4663 AND hash=$1`, block)
	check(true)
	receipt.Logs = []chainrpc.Log{summary, swap}
	exec(`UPDATE tickergarden.chain_receipts SET payload=$2 WHERE chain_id=4663 AND transaction_hash=$1`, transaction, raw(receipt))
	check(false)
}
