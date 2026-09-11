const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

export interface DatabaseRoles {
  readonly readApi: string;
  readonly content: string;
  readonly pipeline: string;
}

function identifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`invalid PostgreSQL identifier: ${value}`);
  return `"${value}"`;
}

export function permissionsSql(schemaName: string, roles: DatabaseRoles): string {
  const schema = identifier(schemaName);
  const readApi = identifier(roles.readApi);
  const content = identifier(roles.content);
  const pipeline = identifier(roles.pipeline);

  return `
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM PUBLIC;

GRANT USAGE ON SCHEMA ${schema} TO ${readApi}, ${content}, ${pipeline};

GRANT SELECT ON
  ${schema}.deployments,
  ${schema}.contract_sources,
  ${schema}.chain_blocks,
  ${schema}.covered_ranges,
  ${schema}.publications,
  ${schema}.publication_pointers,
  ${schema}.projection_records,
  ${schema}.markets,
  ${schema}.account_facts,
  ${schema}.display_records,
  ${schema}.config_records,
  ${schema}.market_trades,
  ${schema}.market_candles,
  ${schema}.holder_balances,
  ${schema}.holder_snapshots,
  ${schema}.detail_fee_totals,
  ${schema}.detail_fee_events,
  ${schema}.user_activity,
  ${schema}.transaction_receipts,
  ${schema}.aggregate_records,
  ${schema}.price_references,
  ${schema}.reward_history,
  ${schema}.invalidations
TO ${readApi};

GRANT SELECT, INSERT, UPDATE ON ${schema}.content_objects, ${schema}.content_challenges, ${schema}.content_uploads TO ${content};

GRANT SELECT, UPDATE ON ${schema}.queue_generations TO ${content};
GRANT SELECT, INSERT, UPDATE ON
  ${schema}.inbox_messages,
  ${schema}.jobs,
  ${schema}.outbox_messages,
  ${schema}.job_attempts
TO ${content};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${content};

GRANT SELECT, INSERT, UPDATE, DELETE ON
  ${schema}.deployments,
  ${schema}.contract_sources,
  ${schema}.chain_blocks,
  ${schema}.chain_logs,
  ${schema}.covered_ranges,
  ${schema}.ingestion_checkpoints,
  ${schema}.webhook_configs,
  ${schema}.source_conflicts,
  ${schema}.publication_pointers,
  ${schema}.projection_records,
  ${schema}.projection_checkpoints,
  ${schema}.markets,
  ${schema}.account_facts,
  ${schema}.display_records,
  ${schema}.config_records,
  ${schema}.market_trades,
  ${schema}.market_candles,
  ${schema}.holder_balances,
  ${schema}.holder_snapshots,
  ${schema}.detail_fee_totals,
  ${schema}.detail_fee_events,
  ${schema}.user_activity,
  ${schema}.transaction_receipts,
  ${schema}.aggregate_records,
  ${schema}.price_references,
  ${schema}.reward_history,
  ${schema}.invalidations
TO ${pipeline};
GRANT SELECT, INSERT ON ${schema}.publications TO ${pipeline};
GRANT SELECT, UPDATE ON ${schema}.queue_generations TO ${pipeline};
GRANT SELECT, INSERT, UPDATE ON
  ${schema}.inbox_messages,
  ${schema}.jobs,
  ${schema}.outbox_messages,
  ${schema}.job_attempts
TO ${pipeline};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${pipeline};

ALTER TABLE ${schema}.inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.inbox_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.outbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.outbox_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.job_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.queue_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${schema}.queue_generations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_inbox_queue ON ${schema}.inbox_messages;
DROP POLICY IF EXISTS content_jobs_queue ON ${schema}.jobs;
DROP POLICY IF EXISTS content_outbox_queue ON ${schema}.outbox_messages;
DROP POLICY IF EXISTS content_attempts_queue ON ${schema}.job_attempts;
DROP POLICY IF EXISTS pipeline_inbox_queue ON ${schema}.inbox_messages;
DROP POLICY IF EXISTS pipeline_jobs_queue ON ${schema}.jobs;
DROP POLICY IF EXISTS pipeline_outbox_queue ON ${schema}.outbox_messages;
DROP POLICY IF EXISTS pipeline_attempts_queue ON ${schema}.job_attempts;
DROP POLICY IF EXISTS content_generation_queue ON ${schema}.queue_generations;
DROP POLICY IF EXISTS pipeline_generation_queue ON ${schema}.queue_generations;

CREATE POLICY content_inbox_queue ON ${schema}.inbox_messages TO ${content} USING (queue='content') WITH CHECK (queue='content');
CREATE POLICY content_jobs_queue ON ${schema}.jobs TO ${content} USING (queue='content') WITH CHECK (queue='content');
CREATE POLICY content_outbox_queue ON ${schema}.outbox_messages TO ${content} USING (queue='content') WITH CHECK (queue='content');
CREATE POLICY content_attempts_queue ON ${schema}.job_attempts TO ${content} USING (queue='content') WITH CHECK (queue='content');
CREATE POLICY content_generation_queue ON ${schema}.queue_generations TO ${content} USING (queue='content') WITH CHECK (queue='content');

CREATE POLICY pipeline_inbox_queue ON ${schema}.inbox_messages TO ${pipeline} USING (queue='chain') WITH CHECK (queue='chain');
CREATE POLICY pipeline_jobs_queue ON ${schema}.jobs TO ${pipeline} USING (queue='chain') WITH CHECK (queue='chain');
CREATE POLICY pipeline_outbox_queue ON ${schema}.outbox_messages TO ${pipeline} USING (queue='chain') WITH CHECK (queue='chain');
CREATE POLICY pipeline_attempts_queue ON ${schema}.job_attempts TO ${pipeline} USING (queue='chain') WITH CHECK (queue='chain');
CREATE POLICY pipeline_generation_queue ON ${schema}.queue_generations TO ${pipeline} USING (queue='chain') WITH CHECK (queue='chain');
`;
}
