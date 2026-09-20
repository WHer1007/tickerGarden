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
GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.rpc_budgets, ${schema}.rpc_leases, ${schema}.rpc_read_cache, ${schema}.rpc_scan_cache, ${schema}.rpc_read_locks TO ${pipeline}, ${readApi};
GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.display_event_inbox, ${schema}.display_event_applied, ${schema}.display_event_coverage TO ${pipeline};
GRANT SELECT, INSERT ON ${schema}.holder_snapshot_evidence TO ${pipeline};
GRANT SELECT ON ${schema}.creator_reward_epochs, ${schema}.creator_reward_balances TO ${readApi};
GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.creator_reward_epochs, ${schema}.creator_reward_balances TO ${pipeline};
REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM PUBLIC;

GRANT USAGE ON SCHEMA ${schema} TO ${readApi}, ${content}, ${pipeline};

GRANT SELECT ON
  ${schema}.deployments,
  ${schema}.contract_sources,
  ${schema}.chain_blocks,
  ${schema}.covered_ranges,
  ${schema}.ingestion_checkpoints,
  ${schema}.publications,
  ${schema}.publication_pointers,
  ${schema}.projection_records,
  ${schema}.projection_read_records,
  ${schema}.market_record_versions,
  ${schema}.principal_record_versions,
  ${schema}.trade_flow_rollups,
  ${schema}.trade_time_buckets,
  ${schema}.statistics_cache_versions,
  ${schema}.projection_checkpoints,
  ${schema}.markets,
  ${schema}.recent_markets,
  ${schema}.explore_display_cards,
  ${schema}.explore_cap_snapshots,
  ${schema}.explore_cap_ranks,
  ${schema}.confirmed_display_markets,
  ${schema}.confirmed_display_cursor,
  ${schema}.account_facts,
  ${schema}.display_records,
  ${schema}.config_records,
  ${schema}.market_trades,
  ${schema}.market_latest_buys,
  ${schema}.protocol_statistics_snapshots,
  ${schema}.stats_display_snapshots,
  ${schema}.market_cap_snapshots,
  ${schema}.market_cap_ranks,
  ${schema}.market_candles,
  ${schema}.holder_balances,
  ${schema}.holder_market_assets,
  ${schema}.holder_account_refs,
  ${schema}.holder_exclusion_refs,
  ${schema}.holder_market_counts,
  ${schema}.holder_snapshots,
  ${schema}.holder_reward_markets,
  ${schema}.holder_reward_datasets,
  ${schema}.holder_reward_wallet_proofs,
  ${schema}.holder_reward_rounds,
  ${schema}.holder_reward_claims,
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
  ${schema}.history_contributions,
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
  ${schema}.projection_read_records,
  ${schema}.market_record_versions,
  ${schema}.principal_record_versions,
  ${schema}.trade_flow_rollups,
  ${schema}.trade_time_buckets,
  ${schema}.statistics_cache_versions,
  ${schema}.projection_observations,
  ${schema}.market_work_candidates,
  ${schema}.principal_candidates,
  ${schema}.principal_ledger,
  ${schema}.principal_work,
  ${schema}.stake_summary_work,
  ${schema}.holder_snapshot_work,
  ${schema}.holder_snapshot_balances,
  ${schema}.holder_snapshot_nodes,
  ${schema}.stake_cleanup_observations,
  ${schema}.holder_work_candidates,
  ${schema}.holder_work_events,
  ${schema}.holder_market_work,
  ${schema}.market_time_refresh,
  ${schema}.market_observation_work,
  ${schema}.market_creation_directory,
  ${schema}.projection_checkpoints,
  ${schema}.markets,
  ${schema}.recent_markets,
  ${schema}.explore_cap_snapshots,
  ${schema}.explore_cap_ranks,
  ${schema}.confirmed_display_markets,
  ${schema}.confirmed_display_cursor,
  ${schema}.confirmed_display_journal,
  ${schema}.display_log_scan,
  ${schema}.stats_display_flows,
  ${schema}.stats_display_buckets,
  ${schema}.stats_display_positions,
  ${schema}.stats_display_markets,
  ${schema}.stats_display_counts,
  ${schema}.stats_display_stock_totals,
  ${schema}.stats_display_wallet_refs,
  ${schema}.account_facts,
  ${schema}.display_records,
  ${schema}.config_records,
  ${schema}.market_trades,
  ${schema}.market_latest_buys,
  ${schema}.protocol_statistics_snapshots,
  ${schema}.stats_display_snapshots,
  ${schema}.market_cap_snapshots,
  ${schema}.market_cap_ranks,
  ${schema}.market_candles,
  ${schema}.holder_balances,
  ${schema}.holder_market_assets,
  ${schema}.holder_account_refs,
  ${schema}.holder_exclusion_refs,
  ${schema}.holder_market_counts,
  ${schema}.holder_snapshots,
  ${schema}.holder_reward_markets,
  ${schema}.holder_reward_rounds,
  ${schema}.holder_reward_claims,
  ${schema}.detail_fee_totals,
  ${schema}.detail_fee_events,
  ${schema}.user_activity,
  ${schema}.transaction_receipts,
  ${schema}.aggregate_records,
  ${schema}.price_references,
  ${schema}.reward_history,
  ${schema}.invalidations
TO ${pipeline};
GRANT SELECT ON ${schema}.holder_snapshots_covered TO ${readApi}, ${pipeline};
GRANT SELECT, INSERT ON ${schema}.publications TO ${pipeline};
GRANT SELECT ON ${schema}.content_objects, ${schema}.explore_display_cards TO ${pipeline};
GRANT SELECT, INSERT ON ${schema}.holder_reward_datasets TO ${pipeline};
GRANT SELECT, INSERT, DELETE ON ${schema}.holder_reward_wallet_proofs TO ${pipeline};
REVOKE UPDATE, DELETE ON ${schema}.holder_reward_datasets FROM ${pipeline};
GRANT UPDATE(verified_header) ON ${schema}.holder_reward_datasets TO ${pipeline};
GRANT SELECT, UPDATE ON ${schema}.queue_generations TO ${pipeline};
GRANT SELECT, INSERT, UPDATE ON
  ${schema}.inbox_messages,
  ${schema}.jobs,
  ${schema}.outbox_messages,
  ${schema}.job_attempts
TO ${pipeline};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${pipeline};
-- Only disposable display statistics get Read API write permission.
GRANT SELECT,INSERT,UPDATE,DELETE ON ${schema}.statistics_result_cache TO ${readApi},${pipeline};

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

/** The relay source role may append events, but cannot change display/settlement state. */
export function displayRelayPermissionsSql(schemaName:string,role:string):string {
 return `GRANT USAGE ON SCHEMA ${identifier(schemaName)} TO ${identifier(role)};\nGRANT INSERT ON ${identifier(schemaName)}.display_event_inbox TO ${identifier(role)};`;
}
