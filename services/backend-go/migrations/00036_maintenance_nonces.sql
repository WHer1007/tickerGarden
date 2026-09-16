-- +goose Up
CREATE TABLE tickergarden.maintenance_nonce_accounts (
    chain_id bigint NOT NULL,
    genesis_hash text NOT NULL CHECK (genesis_hash ~ '^0x[0-9a-f]{64}$'),
    sender text NOT NULL CHECK (sender ~ '^0x[0-9a-f]{40}$'),
    next_nonce bigint NOT NULL CHECK (next_nonce >= 0),
    PRIMARY KEY(chain_id,genesis_hash,sender)
);
CREATE TABLE tickergarden.maintenance_nonce_reservations (
    job_key text PRIMARY KEY REFERENCES tickergarden.maintenance_jobs(job_key),
    generation bigint NOT NULL,
    chain_id bigint NOT NULL,
    genesis_hash text NOT NULL,
    sender text NOT NULL,
    nonce bigint NOT NULL CHECK (nonce >= 0),
    simulation_digest text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(chain_id,genesis_hash,sender,nonce),
    FOREIGN KEY(job_key,generation) REFERENCES tickergarden.maintenance_leases(job_key,generation),
    FOREIGN KEY(job_key,simulation_digest) REFERENCES tickergarden.maintenance_simulations(job_key,digest),
    FOREIGN KEY(chain_id,genesis_hash,sender) REFERENCES tickergarden.maintenance_nonce_accounts(chain_id,genesis_hash,sender)
);

-- +goose Down
DROP TABLE tickergarden.maintenance_nonce_reservations;
DROP TABLE tickergarden.maintenance_nonce_accounts;
