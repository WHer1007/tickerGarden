-- +goose Up
CREATE TABLE tickergarden.maintenance_leases (
    job_key text NOT NULL REFERENCES tickergarden.maintenance_jobs(job_key),
    generation bigint NOT NULL CHECK (generation > 0),
    owner text NOT NULL CHECK (owner ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
    token text NOT NULL CHECK (token ~ '^0x[0-9a-f]{64}$' AND token <> '0x0000000000000000000000000000000000000000000000000000000000000000'),
    ttl_seconds integer NOT NULL CHECK (ttl_seconds BETWEEN 10 AND 300),
    expires_at timestamptz NOT NULL,
    released boolean NOT NULL DEFAULT false,
    PRIMARY KEY(job_key,generation),
    UNIQUE(job_key,token)
);
CREATE TABLE tickergarden.maintenance_lease_events (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_key text NOT NULL,
    generation bigint NOT NULL,
    action text NOT NULL CHECK (action IN ('acquired','renewed','released')),
    expires_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(job_key,generation) REFERENCES tickergarden.maintenance_leases(job_key,generation)
);

-- +goose Down
DROP TABLE tickergarden.maintenance_lease_events;
DROP TABLE tickergarden.maintenance_leases;
