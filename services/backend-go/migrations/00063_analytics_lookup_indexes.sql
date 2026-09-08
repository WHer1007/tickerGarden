-- +goose Up
-- Match the predicates used by canonical analytics readers. Index only execution
-- events; unrelated events and accounting observations do not pay this cost.
CREATE INDEX projection_curve_execution_lookup ON tickergarden.projection_rows
 (chain_id, (payload->'provenance'->>'emitter'), block_hash)
 WHERE table_name='events' AND payload->>'signature' IN
 ('CurveBuy(address,address,uint256,uint256,uint256,uint256)',
  'CurveSell(address,address,uint256,uint256,uint256,uint256)');
CREATE INDEX projection_pool_execution_lookup ON tickergarden.projection_rows
 (chain_id, (payload->'args'->>'id'), block_hash)
 WHERE table_name='events' AND payload->>'signature'='Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)';
CREATE INDEX projection_market_pool_lookup ON tickergarden.projection_rows
 (chain_id, (payload->'values'->>'poolId')) WHERE table_name='markets';
CREATE INDEX projection_swap_fee_lookup ON tickergarden.projection_rows
 (chain_id, (payload->>'hookFeeEventKey'))
 WHERE table_name='swaps' AND payload->>'hookFeeEventKey' IS NOT NULL;

-- +goose Down
DROP INDEX tickergarden.projection_swap_fee_lookup;
DROP INDEX tickergarden.projection_market_pool_lookup;
DROP INDEX tickergarden.projection_pool_execution_lookup;
DROP INDEX tickergarden.projection_curve_execution_lookup;
