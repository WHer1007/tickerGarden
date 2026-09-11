# TickerGarden TypeScript Serverless backend

Implementation target: Node.js 24, TypeScript, Hono and Vercel Functions. The code includes the PostgreSQL foundation, reliable jobs, current-release chain ingestion, immutable publications, all current frontend read routes, transaction observation, reward/activity history, snapshot updates, and recoverable content publication. External Preview and production gates remain task-gated in `docs/v1/V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md`.

Run `npm install`, then `npm test`, `npm run build`, `npm run test:contract` and `npm run test:recovery` from this directory. Integration and recovery commands need `TG_MIGRATION_DATABASE_URL` or `TG_DATABASE_URL`; the repository environment launcher supplies an isolated local PostgreSQL instance. Each app exports a Hono application from `src/index.ts` and a Vercel function from `api/index.ts`.

The read-only current-release chain gates are `npm run verify:rpc`, `npm run verify:current-bootstrap`, and `npm run verify:current-events`. They bind to the source-locked baseline, require two identity-checked RPC providers for bootstrap/event verification, and report a limited `deployment-and-bootstrap-only` scope when the current release has no frozen QA market range. Historical F72 market journals are not accepted as current-release evidence.

Run `npm run check:vercel-packaging` with Node 24 before a Preview deployment. It verifies the npm workspace/lockfile graph, explicit direct dependencies, per-app Node engine, `vercel.json`, and loads each `api/index.ts` from its intended Vercel Project Root. The intended roots are `apps/read-api`, `apps/pipeline`, and `apps/content` relative to this workspace. In every Vercel Project, enable **Include source files outside of the Root Directory in the Build Step** and confirm in Preview build logs that dependency installation uses `services/backend-ts/package-lock.json`; the local check cannot inspect either Dashboard state.

After deployment, set `TG_PREVIEW_READ_API_URL`, `TG_PREVIEW_PIPELINE_URL`, `TG_PREVIEW_CONTENT_URL`, and `TG_PREVIEW_ALLOWED_ORIGIN` to credential-free HTTPS origins and run `npm run accept:preview`. The command checks liveness/readiness, exact CORS, mutation rejection, forged relay signature rejection, and a 10-request concurrency sample; it prints hostname-only JSON evidence and never prints credentials. It does not replace a real matched WebSocket log, signed queue redelivery, database migration evidence, or browser flow validation.

For the web deployment, also set `TG_PREVIEW_WEB_URL` and `TG_PREVIEW_READ_API_URL`, then run `npm --prefix ../../apps/web run accept:preview:browser` from this directory. The browser gate uses pinned `playwright-core` with a trusted local Chrome, discovers a real market through the Preview Read API, and checks desktop/mobile routes, draft recovery, wallet account/chain changes, legacy Rewards links, Vercel headers and the SPA/API rewrite boundary. Set `TG_BROWSER_EVIDENCE_FILE` to retain its redacted JSON result. Local mode (`TG_BROWSER_ACCEPT_LOCAL=1`) is only a production-build smoke and deliberately skips Vercel platform checks.

`npm run generate:openapi` is the only Read API contract generator. The generated client is copied into the frontend by `npm --prefix apps/web run generate:client`; the Go tree is never read by this chain.

The database package contains the bounded frontend read model, exact address/hash/uint256/time codecs, a module-scoped `pg` pool, Drizzle declarations and an explicit SQL migration. The jobs package adds transactional inbox/outbox/jobs, lease fencing, bounded retries, QStash raw-body verification, fixed destinations and deterministic publish deduplication. The chain packages bind ingestion to the current source-locked test release, verify fixed and discovered runtime code hashes with two RPC providers, and process at most ten blocks per job. Some generated files and projector functions retain `f72` in their names as frozen internal compatibility identifiers; they do not select the runtime release. Run the real PostgreSQL acceptance test through the repository environment launcher:

```sh
node tools/environment.mjs run test tooling npm --prefix services/backend-ts run test:integration
```

Migration is an operator action and is never called from service startup or request handling. The management connection and all three pre-created runtime roles are mandatory:

```sh
TG_MIGRATION_DATABASE_URL=... \
TG_DB_ROLE_READ_API=... \
TG_DB_ROLE_CONTENT=... \
TG_DB_ROLE_PIPELINE=... \
npm run migrate
```

The migration runner takes a transaction-scoped advisory lock, records and verifies the migration SHA-256 digest, and applies least-privilege grants. `read-api` can only select published/read-model tables, `content` can only read and write content objects, and `pipeline` cannot access content objects. Publications are append-only; only their pointer can advance atomically.

Environment ownership:

- read-api: `TG_READ_DATABASE_URL`, `TG_ALLOWED_ORIGINS`
- content: `TG_CONTENT_DATABASE_URL`, `TG_CONTENT_BUCKET`, content-only storage and queue credentials, `TG_ALLOWED_ORIGINS`
- pipeline: `TG_PIPELINE_DATABASE_URL`, QStash credentials and server-side RPC configuration; the test VPS WebSocket relay is the chain event entry
- deployment tooling only: `ALCHEMY_AUTH_TOKEN`; never inject it into these runtime applications

Pipeline and content deployments also pin `TG_PIPELINE_GENERATION` and `TG_CONTENT_GENERATION` respectively. Both start at `0`. Migration `0002_queue_generation_fence` stores the active generation per queue. Enqueue, claim, repair and dispatch take a shared database lock and reject a runtime whose configured generation is stale. The protected `POST /internal/generation/advance` accepts canonical decimal-string `expectedGeneration` and `nextGeneration`, requires an exact increment of one, and refuses to advance until every job is `succeeded` and every outbox delivery is `sent`; `dead` work blocks cutover until it is explicitly repaired.

The test-chain event entry is a VPS Alchemy WebSocket `eth_subscribe("logs")` relay. It combines fixed release-bound addresses with dynamic addresses from `contract_sources` and the frontend topic0 allowlist, while shared PoolManager Swap logs additionally require a registered project poolId in topic1. It writes matches to a PostgreSQL durable inbox/checkpoint and wakes the Vercel pipeline only after commit. Reconnects and new address or pool registration use bounded `eth_getLogs`; `removed` logs enter rewind/reingest. Both prior Custom Webhooks were deleted after live testing showed per-block delivery even with filtered empty results.

Chain and content use distinct QStash publish tokens and fixed callback URLs. Both receive the rotating QStash verification keys in their own Vercel project. `CRON_SECRET` authenticates the production GET cron that repairs expired leases and dispatches due outbox rows once per minute; `TG_REPAIR_TOKEN` separately protects operator POST repair/dispatch calls. Provider calls happen outside database transactions, and a stable QStash deduplication ID makes a crash after publish safe to retry. The pipeline price refresh uses `TG_PRICE_REFRESH_TOKEN` for the test VPS scheduler and `CRON_SECRET` for Vercel Cron and runs every five minutes. On Robinhood testnet it verifies each saved Synthra V3 pool's token ordering at a fixed block, combines the pool spot with an expiring ETH/USD reference, and writes display-only USD references to PostgreSQL. The frontend reads the complete cached catalog into one application-wide observable store. Failed or stale observations remain unavailable and never feed transaction quotes or settlement.

Principal projection replays authenticated `UserStockVault` events from the deployment boundary and verifies every discovered account and allocation against both RPC providers at one finalized block. Gauge active/pending principal, activation state, claimable assets and rage-quit settlement are read at that same block. `/v1/users/{address}/accounts` and `/v1/users/{address}/positions` are database-only, revision-bound and user-filtered; `allocated` remains the total and always equals the published active plus pending components. A pending rage-quit settlement is withheld from the normal position view, and fully cleared positions are removed. Wallet writes, simulation and the direct Vault rage-quit escape remain frontend-to-chain operations.

`/internal/live` proves that the function executes. `/internal/ready` proves only that required configuration is present; later tasks add database and provider checks. Neither endpoint claims that frontend business data is ready.
