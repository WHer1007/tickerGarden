-- RH/BNB testnet fallback ONLY: these rows are project-indexed snapshots,
-- not evidence of native Dune support. Native queries may emit the same payload
-- contract without an upload table when their chain/protocol coverage is verified.
-- Replace dune.YOUR_NAMESPACE.YOUR_TABLE with the exact full_name returned by
-- `dune-detail-upload.mjs create`. Do not infer a prefix or table name.
-- Save this query, schedule it at <=10 minute intervals (plan permitting), and
-- set its ID as TG_DUNE_DETAIL_QUERY_ID. The API reads latest completed results.
WITH latest AS (
 SELECT payload, as_of,
        row_number() OVER (
          PARTITION BY chain_id, market_id, period
          ORDER BY as_of DESC, snapshot_id DESC
        ) AS rn
 FROM dune.YOUR_NAMESPACE.YOUR_TABLE
 WHERE chain_id = 46630 -- set to the target network, never mix mainnet/testnet
)
SELECT payload
FROM latest
WHERE rn = 1
  AND as_of >= CAST(to_unixtime(current_timestamp) AS bigint) - 1200
  AND as_of <= CAST(to_unixtime(current_timestamp) AS bigint) + 30
-- Do not add LIMIT: truncated multi-market results are rejected by the adapter.
