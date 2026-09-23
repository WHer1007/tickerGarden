\set ON_ERROR_STOP on
-- Run as the database administrator, once per database, after PostgreSQL restarts
-- with the updated image. No application role receives pg_read_all_stats.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT current_database() AS database, current_setting('shared_preload_libraries') AS preload,
 current_setting('log_min_duration_statement') AS slow_statement_ms,
 current_setting('log_parameter_max_length') AS parameter_log_limit,
 current_setting('track_io_timing') AS io_timing;
-- Fail if preloading is missing, rather than reporting an installed but unusable view.
SELECT count(*) AS statement_entries FROM pg_stat_statements;
