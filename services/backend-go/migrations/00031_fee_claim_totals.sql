-- +goose Up
ALTER TABLE tickergarden.projection_rows DROP CONSTRAINT projection_rows_table_name_check;
ALTER TABLE tickergarden.projection_rows ADD CONSTRAINT projection_rows_table_name_check CHECK(table_name IN ('events','configs','markets','pools','poolEvents','curveTrades','stockPositions','allocations','activationBuckets','gaugePositions','rewardExits','feeCredits','feeClaims','swaps','observations','feeClaimTotals'));
-- +goose Down
ALTER TABLE tickergarden.projection_rows DROP CONSTRAINT projection_rows_table_name_check;
ALTER TABLE tickergarden.projection_rows ADD CONSTRAINT projection_rows_table_name_check CHECK(table_name IN ('events','configs','markets','pools','poolEvents','curveTrades','stockPositions','allocations','activationBuckets','gaugePositions','rewardExits','feeCredits','feeClaims','swaps','observations'));
