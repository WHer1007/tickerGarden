CREATE TABLE {{schema}}.maintenance_runs(name text PRIMARY KEY,next_run_at timestamptz NOT NULL);
CREATE INDEX jobs_retention_digest ON {{schema}}.jobs(queue,payload_digest);
CREATE INDEX jobs_retention_body ON {{schema}}.jobs(updated_at,id) WHERE queue='chain' AND state='succeeded' AND payload<>'{}'::jsonb;
CREATE INDEX outbox_retention_body ON {{schema}}.outbox_messages(created_at,id) WHERE queue='chain' AND state='sent' AND payload<>'{}'::jsonb;
CREATE INDEX inbox_retention_body ON {{schema}}.inbox_messages(received_at,id) WHERE queue='chain' AND state='processed' AND raw_body<>'';
CREATE INDEX attempts_retention_success ON {{schema}}.job_attempts(started_at,id) WHERE queue='chain' AND outcome IN ('leased','succeeded') AND error_code IS NULL;
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0033_queue_retention');
