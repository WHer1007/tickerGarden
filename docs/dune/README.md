# Dune detail query setup

Current approved testnet mode: `TG_TOKEN_DETAIL_SOURCE=indexer` (default). Dune polling and uploads are not required. All optional Dune instructions below require explicitly setting `TG_TOKEN_DETAIL_SOURCE=dune-first` on the consuming API; keep exporters in `indexer` mode.

The backend accepts one saved query returning one `payload` string per market + chart period. The JSON contract is `TokenDetailResponse` in `services/backend-go/openapi/v1.json`; it can contain native Dune aggregates, uploaded snapshots, or a subset of sections. Missing sections must be JSON `null`. API-side selection is per section, not per symbol.

## Native chain data (preferred when verified)

For a supported chain, write the saved query against that chain's raw/decoded events. Bind the exact MarketCreated market/token/curve/pool/quote addresses and approved quote decimals. Return the same payload contract. Do not substitute public `dex.trades` where it omits custom Curve events or misses fees/internal conversions. Verify full deployment-to-cutoff coverage, the block hash and protocol exclusions before marking holders or cumulative credits available.

Native SQL is deployment-specific: this repository has no verified Dune testnet schema or configured Query ID, so it does not ship guessed executable `robinhood_testnet.*` SQL. Use [the coverage probe](./testnet_coverage_probe.sql) to establish whether the specific testnet transaction/block actually exists first. The Go fallback supplies all supported history sections when Dune cannot.

## Uploaded testnet snapshots

The executable fallback utility exports the existing finalized Go analytics contract; this does **not** outsource indexing to Dune. It is optional if you only need the application on a testnet: direct Go fallback already works. The utility does no remote write unless explicitly invoked in `create` or `upload` mode.

1. Run an exporter Read API with `TG_DUNE_DETAIL_QUERY_ID` / `TG_DUNE_API_KEY` unset and healthy `TG_ANALYTICS_MANIFEST`. This prevents circular Dune-to-Dune export. Use the target chain's deployment manifest and full index coverage.
2. Export (the output file must not already exist):

   ```sh
   node --experimental-strip-types tools/dune-detail-upload.mjs export --api http://127.0.0.1:8790 --markets 0xYOUR_64_HEX_MARKET_ID --file /tmp/token-detail.ndjson
   ```

3. Configure `TG_DUNE_API_KEY` only in the backend environment. Create the uploaded table once:

   ```sh
   node --experimental-strip-types tools/dune-detail-upload.mjs create --namespace YOUR_NAMESPACE --table tg_token_detail
   ```

   The tool defaults to public data. `--private true` requires a Dune plan that supports private uploads. Dune charges for table creation and insertion; no such requests have been made during implementation.

4. Append the fresh export:

   ```sh
   node --experimental-strip-types tools/dune-detail-upload.mjs upload --namespace YOUR_NAMESPACE --table tg_token_detail --file /tmp/token-detail.ndjson
   ```

5. Replace the table reference in `detail_uploaded.sql` with `full_name` returned at creation. Save and run it in Dune; check payload identities, numeric strings, coverage and null fields. Configure the query schedule, then set `TG_DUNE_DETAIL_QUERY_ID` and `TG_DUNE_API_KEY` on the application's Read API and restart that API. The API polls every five minutes and does not execute SQL on page loads.
6. Schedule export/upload separately at a frequency compatible with the 20-minute freshness threshold. Export timestamps are preserved, never reset to upload time. Repeated insertion is deduplicated in the query; storage still grows, so apply a retention policy in the Dune workspace. Do not clear a shared table during a live read.

No credentials, upload, query creation, or scheduled Dune execution are included in the local verification. If the plan cannot schedule frequently enough, the app uses finalized Go fallback; do not relabel old data as current.

Sources: [latest result API](https://docs.dune.com/api-reference/executions/endpoint/get-query-result), [create uploaded table](https://docs.dune.com/api-reference/tables/endpoint/uploads-create), [insert NDJSON](https://docs.dune.com/api-reference/tables/endpoint/uploads-insert).
