# Observability setup runbook

Status: **code integration prepared locally on 2026-09-19; external services are not configured or deployed**. The 2026-09-18 audit found no configured Sentry/Lark delivery path, no Vercel drains, and no verified off-host log collector. This runbook records the implementation scope, required inputs and remaining deployment acceptance. Variable names below match the implementation; enabling them still requires environment-specific acceptance.

This runbook does not authorize production deployment, publication, or sending a Lark test message. Configure one environment at a time and preserve the existing test/production boundary. Never copy production credentials into local or test.

## Inputs to collect

### Sentry project and source maps

The project owner must provide the Sentry organization slug, project slug, and DSN for each application/environment that will report errors. Confirm the project platform, event retention, quota/budget, and whether preview events should be enabled before rollout. A DSN is an ingest endpoint, not a write-capable admin token, but treat it as deployment configuration and restrict allowed origins/rate as supported.

Configuration locations:

| Purpose | Proposed name | Where it belongs |
| --- | --- | --- |
| Server runtime error reporting | `TG_SENTRY_DSN` | Backend/VPS protected environment configuration and the relevant Vercel server project environment, scoped separately by environment |
| Browser error reporting | `VITE_SENTRY_DSN` | Web build environment only; this value is visible to browser users, so never put an admin credential here |
| Private source-map upload | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Build job secret store only; grant the token the minimum project/release permissions needed for artifact upload and do not expose it to runtime functions or the browser |
| Release identity | `TG_RELEASE_COMMIT` | Build/release metadata, set to the accepted source commit and verified against the running release |

Use the platform's protected environment-variable/secret manager for deployed values (separate Preview/test and Production scopes). For local development, use an ignored local env file or the existing secret manager; verify the file is ignored before writing and never commit it. Do not paste tokens or full credential-bearing DSNs into chat, tickets, shell transcripts, or source files. Upload source maps privately and verify that public static assets do not expose them. Disable session replay and personal-data collection by default unless separately reviewed and deliberately enabled.

### Lark alert destination and preferences

The operator must create or select the target Lark alert group and provide a custom-bot webhook URL. Enable signature verification and provide its signing secret; this implementation requires signing. The webhook URL and signing secret are credentials: place them only in the notification service's protected server-side secret store, with separate values per environment. Never use a `VITE_` variable, browser bundle, repository file, issue, or chat message for either value.

Notification configuration:

| Purpose | Proposed name | Scope |
| --- | --- | --- |
| Lark custom bot webhook | `TG_LARK_WEBHOOK_URL` | Notification service server secret only |
| Lark custom bot signing secret | `TG_LARK_SIGNING_SECRET` | Notification service server secret only |
| Log threshold | `TG_LOG_LEVEL` | Per-service runtime configuration; choose the intended level explicitly |

Before enabling delivery, record the operator's notification choices: target group; whether Critical alerts should mention named people; whether Error alerts should mention anyone; desired Warning aggregation threshold; quiet hours or routing exceptions; and whether recovery notices are wanted. The audit's suggested levels (Critical immediate, Error grouped, Warning after repeated/persistent failure, Expected outcomes excluded from immediate paging, Resolved once after recovery) are proposals, not configured policy. Confirm thresholds against the actual service cadence and alert volume. Do not send a test notification until the owner explicitly authorizes that test; document the result and destination without recording the webhook or secret.

## Staged setup and acceptance

### Stage 0: ownership and scope

1. Assign owners for the Sentry organization/project, release build credentials, Lark group/bot, independent health monitor, and log retention destination.
2. Confirm environment mapping and project scopes for local, Preview/test, and Production. Keep their DSNs, bot credentials, databases, RPC access, and queues separate.
3. Confirm Sentry budget/retention and Lark notification preferences. Do not assume a free tier or a delivery SLO.
4. Check final code and deployment manifests for the exact variable names and consumers. The template is config/observability.env.example; successful parsing is not proof of delivery.

Acceptance: an owner-approved environment/configuration matrix exists, with no secret values in the document or repository.

### Stage 1: structured application events and privacy

Implement the shared structured logger and error-event model first. Preserve request and operation correlation, release/environment/service identity, and the relevant flow/step/error code. Record unexpected failures before converting them into user-safe responses; avoid duplicate capture at several layers. Keep expected outcomes such as user cancellation, rejected wallet prompts, and input validation out of unknown-error paging.

Define and test explicit sanitization for authorization headers, cookies, signatures, private keys, RPC/database/webhook URLs, user-provided input, and embedded URLs inside messages, stacks, or causes. Do not log request bodies or raw SDK/provider errors by default. Bound event size and client-side buffering. Financial records and settlement evidence remain in their authoritative stores; logs are diagnostic and must not gate or replace them.

Acceptance: representative server and worker failures include useful sanitized cause/stack and operation context; redaction tests prove secrets and personal input do not appear. Logging transport failure does not change request, transaction, or job outcome.

### Stage 2: Sentry and private source maps

Add browser global error/unhandled-rejection capture and explicit capture at important handled failure boundaries. Add server/Hono and worker capture with environment and release identity. Do not treat installing an SDK as proof that locally caught errors are captured. Use bounded delivery and the platform's supported flush/lifecycle mechanism; business work must not wait indefinitely for telemetry.

Configure the scoped DSNs and build-only source-map upload credentials through approved secret/configuration stores. Upload maps privately for the exact release and ensure the browser events carry that same release identifier. Check origin restrictions, event rate limits, filtering, and source-map symbolication without publishing map files.

Acceptance: a controlled, non-production unknown browser error and server exception arrive in the intended Sentry projects, correlate to the tested release, and symbolicate correctly. A deliberately expected cancellation is not treated as an unknown incident. Verify that source maps and secrets are absent from public assets and logs. Account for offline clients, blocked requests, closed pages, and provider outages: browser delivery cannot be guaranteed at 100%.

### Stage 3: independent availability and off-host retention

Provision an independent health monitor that can detect the application/VPS or reporting path being unavailable, including when the monitored application cannot send its own alert. Define checks for service reachability and meaningful progress (such as recent successful polling, event watermarks, oldest-job age, and sustained failures), not only a self-reported health endpoint. Suppress brief startup transients and validate thresholds per workload.

Set bounded local log rotation/retention and disk-pressure alerts for VPS containers and journald. If cross-provider search or longer centralized retention is required, select and fund an off-host log destination, then configure supported Vercel drains and a VPS collector. Sentry issue tracking is not a complete archive of access/application logs. Treat the independent destination and its credentials as a separate deployment resource; do not add a large self-hosted log cluster to the existing business VPS as an assumed prerequisite.

Acceptance: prove health-monitor delivery while the application reporter is unavailable; prove logs arrive from both Vercel and VPS where configured; verify retention, access controls, rotation, disk-pressure alerting, and recovery. Until these resources are provisioned and exercised, mark independent monitoring/off-host retention as pending.

### Stage 4: Lark notification adapter

Deliver alerts through a server-side adapter that validates the source, deduplicates events, persists delivery state, retries with bounded backoff, and records dead-letter/failure state. Send a recovery notice after sustained healthy checks. Protect against forged browser events and alert floods with origin/release validation, size/rate limits, grouping, and severity rules; these checks reduce abuse but do not replace authentication where required.

The notification request must be asynchronous and bounded: application request handling, transaction/ledger commits, and job completion must never wait for Lark. Delivery must not depend exclusively on the same VPS or business database whose outage it reports. Make webhook delivery failures visible through an independent path.

Acceptance: after explicit authorization for a test send, verify a controlled test alert in the selected group and confirm signing behavior. Exercise duplicate grouping, retry/backoff, rate limiting, timeout/429 handling, dead-letter visibility, and one recovery notice. Confirm the configured mention, warning, and quiet-hour preferences. Never include secrets, full provider URLs, raw user input, or transaction signing material in a card.

## Operational acceptance checklist

Before calling the rollout accepted, retain evidence for each enabled environment and release:

- Unknown browser exception, chunk/resource load failure where supported, unexpected API 5xx, locally caught business-flow failure, RPC timeout/rate limit, database failure, worker retry/dead/crash, stalled progress watermark, and sustained price-coverage failure.
- Expected wallet rejection/user cancellation classification; ordinary market inactivity must not trigger a price outage alert.
- Sanitized logs and alert cards, correlation from browser operation through request/worker where available, and exact release symbolication.
- Sentry outage, Lark timeout/429, offline/closed browser, reporter shutdown, independent health-check detection, and recovery behavior.
- Duplicate aggregation, severity thresholds, recipient mentions, and notification preferences.
- No public source maps, exposed tokens/webhooks, unbounded logs, or user/financial work blocked on telemetry delivery.

Record date, environment, commit/release, test event identifiers, observed delivery latency, owner, and unresolved failures. Do not describe an untested stage or an unset secret as integrated. Production configuration requires the normal production authorization and deployment gates; this runbook grants neither.

## Source audit

The baseline and known gaps are documented in [LOGGING_OBSERVABILITY_AUDIT_2026-09-18.md](../reviews/LOGGING_OBSERVABILITY_AUDIT_2026-09-18.md). That audit found partial request/job diagnostics, but no verified unified error collection, Lark sender, active external log drain, or independent availability delivery path at the time checked.

## Prepared implementation and exact enablement boundary

The checked-in `config/observability.env.example` contains blank values only. Copy the required service-scoped values into a private ignored `.env.observability.local` (chmod 0600) or the deployment secret manager; verify git check-ignore first. No real credentials are required to run the unit tests. No notification process has been started by this change.

- Browser: `VITE_SENTRY_DSN`, `VITE_TG_ENVIRONMENT` and `VITE_RELEASE_COMMIT`. The SDK loads only with a DSN. Client requestId is taken from typed API errors when available; arbitrary wallet operations are not automatically trace-correlated to every background task.
- Backend/VPS: `TG_SENTRY_DSN`, `TG_LOG_LEVEL`, `TG_RELEASE_COMMIT`, plus the existing `TG_ENVIRONMENT`. Hono requests use AsyncLocalStorage for request context. Error/warning fingerprints are emitted at most once per minute with an accumulated count on the next emission. Expected user rejection/aborted requests are filtered in browser reporting.
- Build-only: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. With these configured, Vite creates hidden maps, uploads them and removes map files from output. Without the token, no maps are generated. Supply the same accepted SHA for browser release and backend release. A successful real upload and symbolication still require Sentry credentials.
- Optional notification intake: `TG_ALERT_INGEST_URL` (HTTPS `/alerts`) and a random per-environment `TG_ALERT_INGEST_TOKEN` (minimum32 characters). Never expose this token to browsers. Server reports enqueue asynchronously; queue/HTTP failure is logged without changing business outcomes.
- Dedicated alert process: `TG_ENVIRONMENT`, `TG_ALERT_SPOOL_DIR` (private absolute directory), `TG_ALERT_INGEST_TOKEN`, `TG_LARK_WEBHOOK_URL`, `TG_LARK_SIGNING_SECRET`, `TG_ALERT_PORT` (default8090) and **`TG_ALERT_DELIVERY_ENABLED=true`**. Run `node --experimental-strip-types scripts/alert-worker.ts` from `services/backend-ts` only after notification authorization and configuration. It listens on loopback; reverse proxy HTTPS is an explicit infrastructure step. Separate spools/listeners/tokens/bots per environment. Prefer running it on an independent host.
- Manual operator drain: `scripts/send-alerts.ts --send`; this intentionally requires explicit send. Do not run it against a real group merely to check configuration.
- Local spool: maximum1000 incident files, permissions0600/0700, atomic writes and a bounded cross-process lock. Duplicate events aggregate within5minutes; sending retries up to6attempts with capped backoff. Dead records remain inspectable and a new occurrence can reactivate after1hour. Delivered idle records are pruned after24hours; provision retention/export for dead records. Review a stale `.lock` after a crash; do not blindly remove a potentially active lock.
- Transport is at-least-once: a crash after Lark accepts but before local state is saved can cause a duplicate on recovery. It is not an exactly-once promise. Queue overflow/intake failure is visible as `alert_enqueue_failed`; independent monitoring must catch it.
- `resolved` severity is supported, but actual health-threshold evaluation and automatic recovery notices require the independent monitor; the module does not infer that a missing error means recovery.
- Web `/api/rpc` and market-page functions emit safe structured Vercel logs. Those functions do not run the Node Sentry module; their remote capture/notification needs the Vercel drain route or an explicit server SDK integration in a later deployment.
- No VPS log rotation, external drain, reverse proxy, off-host collector, monitoring subscription or production runtime settings were changed in this local implementation. Those operational steps remain pending resource selection and deployment.

Deployment templates are `infra/vps/systemd/tickergarden-alerts@.service` (disabled until installed/enabled) and `infra/vps/observability/retention.example.md` (merge only after disk/retention review). Neither is applied by this change. HTTPS intake has two bounded delivery attempts; permanent auth failures do not retry. This still cannot guarantee delivery if the intake remains unavailable; Sentry/local logs and independent monitoring are the fallback, not a promise of lossless browser or process-crash reporting.
