-- +goose Up
-- Reserve the backend namespace. No protocol balances or synthetic data are created.
CREATE SCHEMA tickergarden;

-- +goose Down
-- Intentionally no CASCADE: rollback must fail if subsequent business tables remain.
DROP SCHEMA tickergarden;
