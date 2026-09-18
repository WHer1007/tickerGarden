# Confirmed display and settlement

The public market page, market statistics and financial settlement have independent lifecycles. No page-access health check or coherent accounts/positions publication is required by `GET /v1/markets/{marketId}/page`.

## Public display

`confirmed-display-worker.ts` is an independent read-only-chain process. It verifies chain identity, event logs against successful full transaction receipts, and canonical block hashes before committing market display changes. It scans to the latest head in bounded ranges, with event wakeups and a 30-second missed-notification scan. No provider USD price is fetched by this process; all USD displays continue to use the shared five-minute price catalog.

The worker stores current per-market display state and a bounded-by-finality undo journal. A changed canonical hash restores predecessor states and deletes markets created only on the orphaned branch, then replays the replacement branch. Fixed issuance remains configuration data; circulating supply follows the token's totalSupply and changes with burns. The display reducer reconciles all token balances with supply and the pinned on-chain supply.

The worker updates only affected markets; head advancement proves unchanged values remain current. Protocol event reads use shared topic filters and authenticated emitters. Generic ERC20 Transfer reads are restricted to known project token addresses in batches of 256; response-size failures split the block range (and single-block address batch) without advancing the cursor or dropping events. Trades, transfer balances and fee deltas are applied incrementally. The latest chart interval is open and updates with executions. The retained rolling history supports all three chart ranges and the 24-hour volume window.

These rows are explicitly display-only. Principal projection, Holder reward datasets and settlement never read them. API access to display data does not grant wallet execution authorization; wallet actions still verify deployment bindings, the canonical quote block and simulate transactions. Other financial pages retain their finalized snapshot checks.

## Market-scoped browser invalidations

The display transaction emits PostgreSQL NOTIFY only after its state and rollback journal commit. Notifications contain market ID, source revision and changed region names, never account data or displayed values. Reorgs invalidate all sections of each affected market. Environment, deployment and schema have independent channels.

`GET /v1/markets/{marketId}/events` is an SSE stream. A warm Read API instance shares one LISTEN connection among up to 128 streams, filters by the subscribed market and bounds slow-client queues. The dedicated `api/events.ts` Vercel function has a 300-second runtime limit; streams end at 240 seconds. Ordinary API functions retain their 20-second runtime limit. Count the event function's live instances/connections separately in deployment connection budgets; no 20,000-client capacity claim is made.

The browser coalesces region hints for 120 ms, reads selected `/detail?section=...` sections, and reads `/page` only when core market fields change. Unchanged chart, form state and tables are preserved. Its single 60-second reconciliation sweep recovers missed notifications; reconnect/visibility recovery also reconciles. Failed reads back off to 60 seconds. Receipt-triggered checks remain bounded and private wallet reads are not shared. There are no stream-status UI elements.

The frontend stops the global snapshot poller on Trade, does not join a directory initialization from another route, and prefers verified local creation data during handoff. Shared prices accept all 196 ETH/Stock/USDG entries. The chart includes the open latest interval; staking invalidations cover active-stake changes and scheduled activation, and personal positions retain their own coherent revision.

## Settlement

The default `TG_SETTLEMENT_FINALITY=finalized` uses `eth_getBlockByNumber("finalized")`, chooses the lower configured RPC anchor, and verifies its canonical hash. An RPC failure does not silently downgrade confirmation. Robinhood mainnet's configured RPC was observed to support both `safe` and `finalized` on 2026-09-17.

For an explicitly configured chain/provider without a usable finalized tag, `TG_SETTLEMENT_FINALITY=delay` retains the separate time/block policy. Its default and environment templates use **60 seconds**, plus the configured block depth, rather than 600 seconds. A time window is an operational fallback, not a proof of finality. `safe` is not silently treated as finalized.

## Activation order

1. Use the approved test/production source branches and normal release gates. Apply migration `0019_confirmed_display` and updated grants before deploying the Read API that uses it.
2. Include the additional display worker's maximum two database connections and one LISTEN connection per active event-function instance in the existing connection budget. No additional hosted service is needed.
3. Install the appropriate `tickergarden-confirmed-display-{test,production}.service`. It reuses the environment-specific RPC and database configuration, with health ports 8085/8084 respectively. Run the display and settlement workers independently.
4. Set the settlement mode explicitly. Update existing live `V1_FINALITY_DELAY_SECONDS` values to 60 if the fallback mode is to be used; changing a template does not alter existing production configuration.
5. Verify the initial analytics baseline is chain-finalized. If the old time-based projection is ahead of the actual finalized anchor, the new display worker waits for that baseline to become finalized; it does not import an unsafe financial baseline. Existing verified creation details remain readable during rollout.
6. Verify display cursor lag, real successful receipt ingestion, reorg rollback, quote/balance checks and private reward isolation in test before production publication. Promote only the accepted product tree, with all Vercel runtimes verified in sin1.

The worker's event-driven scheduling and frontend recovery intervals are scheduling targets, not an end-to-end latency guarantee. Receipt RPC latency, queue-free catchup and database load must be measured during acceptance. The current state/undo representation retains full per-market balance snapshots; very large holder populations or trading volume require storage/load measurements before claiming 20,000-market capacity.

## Local verification

Unit tests cover receipt-derived initial state, transfers, burns, duplicate rejection, supply reconciliation, open charts, finalized anchor validation and public page access independent from health. The local PostgreSQL test applies real migrations and verifies cursor idempotency, orphan rollback, post-commit notifications and unchanged financial checkpoints. SSE tests verify market isolation, a shared LISTEN connection and cleanup; browser scheduler tests verify notification coalescing and the 60-second recovery interval. Its seeded reorg journal test supplements, rather than replaces, a live testnet event/reorg acceptance run.


## September 18 preparation and scan upgrade

Apply `0022_display_preparation` and refresh database grants **before** updating the display Worker, Read API and Web (in that order). This migration adds persisted missing-field lists, indexed refresh deadlines and a deployment-scoped scan cache. It does not alter financial tables or finality rules. Old workers remain compatible; do not drop the added columns as an application rollback step.

The Worker runs preparation independently of chain advancement on its existing LISTEN connection using short SQL operations, retaining the two-connection budget. Recent launches with missing content or USD values are repaired from public metadata and the shared price table; confirmed markets have separate bounded lanes for missing data and ordinary rolling windows. Conditional writes and a locked cursor anchor prevent old preparation results from overwriting new events or reorg corrections. Unchanged visible regions emit no notifications. No external price provider is called by preparation.

`GET /v1/markets/{marketId}/launch-readiness` reads the stored readiness fields. A ready response preserves the existing success-page requirement (identity, content, quote binding, prices/cap, holders, chart, trades and fees present); empty activity is valid. This endpoint never starts a repair job or queries RPC. Use `launch_missing`, `refresh_due_at`, `refresh_attempts` and `refresh_error` internally to diagnose stalled preparation.

A project-scoped scan now persists up to 2,000 blocks for reuse by 200-block reducer batches and after process restart. Cache reuse verifies the canonical end-block hash; every applied receipt and reducer anchor retains its existing validation. Keep `CHAIN_RELAY_RECOVERY_OWNER=display` so Relay supplies durable notifications without running a second HTTP gap scan. The cache replaces the previous batch instead of growing without bound. This amortizes catch-up scans; it does not eliminate the bounded full-project recovery scan or prove live 20,000-market throughput.

Acceptance: run content retry, display preparation, display scan, confirmed-display, Explore and Stats DB integrations, then check production-equivalent startup with the existing connection budget. Monitor oldest `refresh_due_at`, readiness missing fields, cursor lag and database load before increasing batch sizes. Keep all migration tests local; environment rollout remains separately authorized.
