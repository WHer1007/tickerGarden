-- +goose Up
ALTER TABLE tickergarden.projection_observation_batches DROP CONSTRAINT projection_observation_batches_scope_check;
ALTER TABLE tickergarden.projection_observation_batches ADD CONSTRAINT projection_observation_batches_scope_check CHECK(scope IN ('market-curve-v1','market-curve-gauge-v1','market-curve-gauge-vault-v1','market-curve-gauge-vault-fees-v1','market-curve-gauge-vault-fees-holder-v1','market-curve-gauge-vault-fees-holder-config-v1','market-curve-gauge-vault-fees-holder-config-route-v1'));
ALTER TABLE tickergarden.projection_block_observations DROP CONSTRAINT projection_block_observations_kind_check;
ALTER TABLE tickergarden.projection_block_observations ADD CONSTRAINT projection_block_observations_kind_check CHECK(kind IN ('market','curve','gauge','gaugePosition','asset','vaultSolvency','vaultPosition','vaultMarket','vaultAllocation','feeLiability','feeSolvency','creatorEpoch','holderMarket','holderEpoch','treasurySolvency','quote','baseline','template','poolKey','canonicalRoute','routeRuntime','poolBinding','lockedPosition'));


-- +goose Down
ALTER TABLE tickergarden.projection_observation_batches DROP CONSTRAINT projection_observation_batches_scope_check;
ALTER TABLE tickergarden.projection_observation_batches ADD CONSTRAINT projection_observation_batches_scope_check CHECK(scope IN ('market-curve-v1','market-curve-gauge-v1','market-curve-gauge-vault-v1','market-curve-gauge-vault-fees-v1','market-curve-gauge-vault-fees-holder-v1','market-curve-gauge-vault-fees-holder-config-v1'));
ALTER TABLE tickergarden.projection_block_observations DROP CONSTRAINT projection_block_observations_kind_check;
ALTER TABLE tickergarden.projection_block_observations ADD CONSTRAINT projection_block_observations_kind_check CHECK(kind IN ('market','curve','gauge','gaugePosition','asset','vaultSolvency','vaultPosition','vaultMarket','vaultAllocation','feeLiability','feeSolvency','creatorEpoch','holderMarket','holderEpoch','treasurySolvency','quote','baseline','template'));

