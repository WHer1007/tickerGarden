-- +goose Up
ALTER TABLE tickergarden.projection_block_observations DROP CONSTRAINT projection_block_observations_kind_check;
ALTER TABLE tickergarden.projection_block_observations ADD CONSTRAINT projection_block_observations_kind_check CHECK(kind IN ('market','curve','gauge','gaugePosition','asset','vaultSolvency','vaultPosition','vaultMarket','vaultAllocation','feeLiability','feeSolvency','creatorEpoch','holderMarket','holderEpoch','treasurySolvency','quote','baseline','template','poolKey','canonicalRoute','routeRuntime','poolBinding','lockedPosition','principalAccount','principalAllocation','rewardPosition','rewardConversionBatch'));


-- +goose Down
ALTER TABLE tickergarden.projection_block_observations DROP CONSTRAINT projection_block_observations_kind_check;
ALTER TABLE tickergarden.projection_block_observations ADD CONSTRAINT projection_block_observations_kind_check CHECK(kind IN ('market','curve','gauge','gaugePosition','asset','vaultSolvency','vaultPosition','vaultMarket','vaultAllocation','feeLiability','feeSolvency','creatorEpoch','holderMarket','holderEpoch','treasurySolvency','quote','baseline','template','poolKey','canonicalRoute','routeRuntime','poolBinding','lockedPosition','principalAccount','principalAllocation','rewardPosition'));

