-- +goose Up
CREATE TABLE tickergarden.settlement_work (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_key text NOT NULL UNIQUE CHECK (job_key ~ '^[0-9a-f]{64}$'),
 chain_id bigint NOT NULL CHECK (chain_id IN (4663,46630,421614)),
 genesis_hash text NOT NULL CHECK (genesis_hash ~ '^0x[0-9a-f]{64}$'),
 operator text NOT NULL CHECK (operator ~ '^0x[0-9a-f]{40}$'),
 market_id text NOT NULL CHECK (market_id ~ '^0x[0-9a-f]{64}$'),
 run_id text NOT NULL CHECK (run_id ~ '^[a-zA-Z0-9._-]{1,128}$'),
 payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 1048576),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','checking','retry','checked_unsigned','failed')),
 generation bigint NOT NULL DEFAULT 0 CHECK (generation>=0),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
 due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claim_until timestamptz NOT NULL DEFAULT '-infinity',
 check_sequence bigint REFERENCES tickergarden.settlement_checks(sequence),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(chain_id,genesis_hash,operator,market_id,run_id),
 CHECK ((status='checked_unsigned') = (check_sequence IS NOT NULL))
);
CREATE UNIQUE INDEX settlement_work_one_active_market ON tickergarden.settlement_work(chain_id,genesis_hash,operator,market_id) WHERE status IN ('queued','checking','retry');
CREATE INDEX settlement_work_due ON tickergarden.settlement_work(chain_id,genesis_hash,operator,due_at,sequence);

-- +goose Down
DROP TABLE tickergarden.settlement_work;
