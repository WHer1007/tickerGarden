-- Operational RPC coordination only. No financial authority is granted by these records.
CREATE TABLE "{{schema}}".rpc_budgets (
 scope text PRIMARY KEY, tokens double precision NOT NULL, updated_at timestamptz NOT NULL, policy_hash text NOT NULL
);
CREATE TABLE "{{schema}}".rpc_leases (
 id uuid PRIMARY KEY, scope text NOT NULL, tier text NOT NULL CHECK(tier IN ('interactive','realtime','background')), expires_at timestamptz NOT NULL
);
CREATE INDEX rpc_leases_scope ON "{{schema}}".rpc_leases(scope,expires_at);
CREATE TABLE "{{schema}}".rpc_read_locks (scope text NOT NULL, key text NOT NULL, owner uuid NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(scope,key));
CREATE TABLE "{{schema}}".rpc_read_cache (
 scope text NOT NULL, key text NOT NULL, payload jsonb NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(scope,key)
);
CREATE INDEX rpc_read_cache_expiry ON "{{schema}}".rpc_read_cache(expires_at);
CREATE TABLE "{{schema}}".rpc_scan_cache (
 scope text NOT NULL, key text NOT NULL, from_block bigint NOT NULL, to_block bigint NOT NULL,
 block_hash text NOT NULL, addresses text[] NOT NULL, topics jsonb NOT NULL,
 payload jsonb NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(scope,key)
);
CREATE INDEX rpc_scan_cache_range ON "{{schema}}".rpc_scan_cache(scope,from_block,to_block);
INSERT INTO "{{schema}}".schema_migrations(version) VALUES('0027_rpc_control');
