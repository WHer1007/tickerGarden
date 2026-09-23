\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
-- No SQL bodies or bound values in this summary. These counters are cumulative;
-- compare two captures, or record stats_reset; do not reset shared statistics.
SELECT now() AS observed_at, stats_reset, dealloc FROM pg_stat_statements_info;
SELECT d.datname,r.rolname,s.queryid,s.calls,
 round(s.total_exec_time::numeric,2) AS total_exec_ms,
 round(s.mean_exec_time::numeric,2) AS mean_exec_ms,
 round(s.max_exec_time::numeric,2) AS max_exec_ms,
 s.rows,s.shared_blks_hit,s.shared_blks_read,s.temp_blks_read,s.temp_blks_written,
 round(coalesce((to_jsonb(s)->>'shared_blk_read_time')::numeric,(to_jsonb(s)->>'blk_read_time')::numeric),2) AS read_ms,round(coalesce((to_jsonb(s)->>'shared_blk_write_time')::numeric,(to_jsonb(s)->>'blk_write_time')::numeric),2) AS write_ms
FROM pg_stat_statements s JOIN pg_database d ON d.oid=s.dbid JOIN pg_roles r ON r.oid=s.userid
WHERE d.datname=current_database() ORDER BY s.total_exec_time DESC LIMIT 30;
SELECT datname,numbackends,temp_files,temp_bytes,deadlocks,stats_reset FROM pg_stat_database WHERE datname=current_database();
SELECT wait_event_type,wait_event,count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' GROUP BY wait_event_type,wait_event;
COMMIT;
