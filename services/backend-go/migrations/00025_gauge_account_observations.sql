-- +goose Up
ALTER TABLE tickergarden.projection_observation_batches DROP CONSTRAINT projection_observation_batches_scope_check;
ALTER TABLE tickergarden.projection_observation_batches ADD CONSTRAINT projection_observation_batches_scope_check CHECK(scope IN ('market-curve-v1','market-curve-gauge-v1','market-curve-gauge-vault-v1','market-curve-gauge-vault-fees-v1','market-curve-gauge-vault-fees-holder-v1','market-curve-gauge-vault-fees-holder-config-v1','market-curve-gauge-vault-fees-holder-config-route-v1','market-curve-gauge-vault-fees-holder-config-route-accounts-v1','market-curve-gauge-vault-fees-holder-config-route-accounts-gauge-v1'));




-- +goose Down
ALTER TABLE tickergarden.projection_observation_batches DROP CONSTRAINT projection_observation_batches_scope_check;
ALTER TABLE tickergarden.projection_observation_batches ADD CONSTRAINT projection_observation_batches_scope_check CHECK(scope IN ('market-curve-v1','market-curve-gauge-v1','market-curve-gauge-vault-v1','market-curve-gauge-vault-fees-v1','market-curve-gauge-vault-fees-holder-v1','market-curve-gauge-vault-fees-holder-config-v1','market-curve-gauge-vault-fees-holder-config-route-v1','market-curve-gauge-vault-fees-holder-config-route-accounts-v1'));



