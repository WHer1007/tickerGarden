# Production RPC optimization — 2026-11-02

Status: implementation verified locally; production code rollout not performed.

## Scope and changes

Prepared on `codex/production-ops-event-only`, isolated from the dirty development checkout, based on production `04f5d0a50c`.

- Display Worker requires a concrete durable inbox event or explicit request before chain access. Startup, health checks, listener repair, idle timeout, and recovery hints do not authorize RPC.
- Price notifications refresh persisted valuations and publish views using PostgreSQL only. They do not advance the chain cursor.
- Removed range-scan recovery from Display Worker. A transport guard rejects `eth_getLogs`, `eth_getBlockReceipts`, batches and untriggered requests before budget acquisition/network access. Inbox reads process one complete pushed block; oversized blocks fail closed. Late events and reorg handling use persisted events/journals. Missing notifications remain an explicit upstream repair requirement.
- Display health identifies `push-only` / `event-only` coverage and failures. Read API health explicitly reports persisted-publication freshness without claiming a live chain-head check. Resident retry counts are labeled cumulative, not a queue backlog.
- RPC usage includes service/environment/chain and concrete display trigger. Slow-query labels identify COMMIT and RPC lease deletion; no speculative index or durability change was made.
- Separate BSC workspace changes count physical HTTP attempts and logical batch RPC operations, including failed retries; endpoints/keys are not logged. This workspace has unrelated changes and must not be released wholesale.

## Live configuration and inspection

Vercel CLI authentication recovered; project access works. No further user login was needed. Production-only Alchemy fallback variables were removed from Web, Read API and chain-pipeline. Their primary RPC variables were explicitly set to the configured production QuickNode endpoint, with target checks and successful API responses. Existing deployment environments do not change until redeployment.

Existing Web (2), Read API (3), chain-pipeline (2), Content (2) runtime functions were checked with `check-vercel-region.mjs`; all were in `sin1`.

Configuration incident: a retry mistakenly updated the Web Preview `TG_WEB_RPC_URL`. It was restored from the saved 2026-09-14 Vercel Preview export and verified by decrypted readback. No deployment occurred. The exact value immediately preceding the mistake is not independently established; the backup may be older. No other Preview variable was intentionally changed. Production-only target checks were applied to all subsequent writes.

## Validation

- Backend full unit/generated-artifact/packaging/contract/typecheck gate: 257 passed, 0 failed.
- Full integration: 60 passed, one connection-format guard failure, one optional 100001-holder capacity test skipped. The failed retention test passed on rerun with the supported localhost URL (30000 historical records, 200-row batch, approximately 24 ms).
- Affected display integration suite: 5 passed, including a real worker process and local PostgreSQL.
- Final real-worker check after health changes: startup, price notification, recovery hint, health and a 30-second idle timeout produced zero upstream HTTP RPC requests.
- Oversized inbox block test uses a transport that throws on any RPC to enforce no saturation fallback.
- BSC metering tests: 18 passed; final TypeScript check passed.
- No production traffic reduction is claimed until release and observation. The optional holder-capacity track was not run for this operations change.

## Release gate and post-release acceptance

Production deployment requires explicit approval under AGENTS.md. Promote only this accepted product tree through `test` to `master`; do not deploy a `codex/*` branch or unrelated local changes. Run deployment-boundary gates. Every Vercel command must include `--regions sin1`; verify each deployment before alias/promotion.

Release needs the Display Worker restart and scoped Web/Read API/Pipeline redeployment to activate configuration. BSC metering needs a separately isolated BSC release. Preserve the prior deployment/worker source for rollback, but never restore Alchemy configuration.

After release: observe a quiet interval and price-only interval with zero display RPC; verify actual event receipt processing, duplicate/late/reorg behavior, explicit gap state, provider=QuickNode and attribution by service. Compare physical calls and logical batch operations across equal observation windows. Do not translate request counts directly into CU without method-specific provider accounting.

## Strict event-boundary follow-up

The initial implementation still queried latest/finalized heads and unrelated late blocks after an event. Those paths have now been removed. A pass resolves exactly one transaction from the durable inbox; a generic explicit request without a transaction may only prepare persisted database views. A missing requested event returns `gap:missing-event` without RPC.

RPC permits only that transaction receipt, that event block, and state calls pinned to the event block/hash. All other methods/tags, unrelated receipts, batches and scope rebinding are rejected before network/budget acquisition. Each trigger has a maximum of 128 physical attempts (including failures/retries) and a 30-second authorization lifetime. The guard denies further attempts after either limit; it does not cancel an already in-flight request.

No live head/finality lookup, unrelated due-market refresh, speculative multi-block canonicality search or background scan remains in the event path. Baselines and historical display views use already persisted database data. Reorg/late-event repair uses at most 100 persisted journal entries per pass and fails visibly beyond that bound. Same-block transactions preserve the original undo boundary. Durable inbox/application/journal evidence is not pruned based on inferred finality by this worker.

Health always reports `synchronized:false`, with `coverage:unverified` or `gap`. An event-only feed cannot prove absence of missing notifications. A database listener reconnect without a pending concrete event authorizes no chain traffic. Production deployment and configuration were not changed by this follow-up.

Follow-up validation: 258 unit tests passed with the backend generated-artifact and TypeScript gates. The full integration run passed 61 tests, skipped one optional capacity test, and found a test-fixture error in the new listener-disconnect check (it selected the wrong last LISTEN channel). After correcting that selector, the actual disconnect/reconnect + 30-second idle/price/recovery process test passed with zero physical RPC requests. The final scoped-event regression and TypeScript check also passed. Listener health now waits until all subscriptions are established. These results are local, not evidence of a production rollout.
