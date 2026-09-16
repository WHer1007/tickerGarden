-- +goose Up
ALTER TABLE tickergarden.chain_journal DROP CONSTRAINT chain_journal_chain_id_check;
ALTER TABLE tickergarden.chain_journal ADD CONSTRAINT chain_journal_chain_id_check CHECK (chain_id IN (4663,46630,421614));

-- +goose Down
-- Fail rather than silently deleting Arbitrum test records when rolling back.
ALTER TABLE tickergarden.chain_journal DROP CONSTRAINT chain_journal_chain_id_check;
ALTER TABLE tickergarden.chain_journal ADD CONSTRAINT chain_journal_chain_id_check CHECK (chain_id IN (4663,46630));
