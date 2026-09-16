-- +goose Up
CREATE TABLE tickergarden.transaction_account_roles (
 chain_id bigint NOT NULL CHECK (chain_id IN (4663,46630,421614)),
 genesis_hash text NOT NULL CHECK (genesis_hash ~ '^0x[0-9a-f]{64}$'),
 sender text NOT NULL CHECK (sender ~ '^0x[0-9a-f]{40}$'),
 role text NOT NULL CHECK (role IN ('maintenance','settlement')),
 PRIMARY KEY(chain_id,genesis_hash,sender)
);
INSERT INTO tickergarden.transaction_account_roles(chain_id,genesis_hash,sender,role) SELECT chain_id,genesis_hash,sender,'maintenance' FROM tickergarden.maintenance_nonce_accounts;
CREATE TABLE tickergarden.settlement_nonce_accounts (
 chain_id bigint NOT NULL,
 genesis_hash text NOT NULL,
 sender text NOT NULL,
 next_nonce bigint NOT NULL CHECK (next_nonce>=0),
 PRIMARY KEY(chain_id,genesis_hash,sender),
 FOREIGN KEY(chain_id,genesis_hash,sender) REFERENCES tickergarden.transaction_account_roles(chain_id,genesis_hash,sender)
);
CREATE TABLE tickergarden.settlement_intents (
 job_key text PRIMARY KEY REFERENCES tickergarden.settlement_work(job_key),
 chain_id bigint NOT NULL,
 genesis_hash text NOT NULL,
 sender text NOT NULL,
 nonce bigint NOT NULL CHECK (nonce>=0),
 check_sequence bigint NOT NULL REFERENCES tickergarden.settlement_checks(sequence),
 maximum_gas_cost numeric(78,0) NOT NULL CHECK (maximum_gas_cost>0),
 payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 65536),
 digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(chain_id,genesis_hash,sender,nonce),
 FOREIGN KEY(chain_id,genesis_hash,sender) REFERENCES tickergarden.settlement_nonce_accounts(chain_id,genesis_hash,sender)
);

-- +goose Down
DROP TABLE tickergarden.settlement_intents;
DROP TABLE tickergarden.settlement_nonce_accounts;
DROP TABLE tickergarden.transaction_account_roles;
