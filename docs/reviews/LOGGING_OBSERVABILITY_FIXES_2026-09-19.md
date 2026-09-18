# Logging and observability implementation — 2026-09-19

Status: locally implemented and tested; not deployed. No Sentry account or Lark bot is configured. No real notification was sent.

## Implemented

- Shared Pino structured logging with service, environment, release and request context; allowlisted operational fields and sanitization of messages, stacks and bounded causes. Unknown HTTP failures, important handled flow failures, worker/job failures and database idle errors retain diagnostic evidence before user-safe responses.
- Optional Sentry server integration and lazy browser integration. Browser capture covers global exceptions, unhandled rejections, resource-load errors and handled Launch/Trade/reward failures. Expected wallet cancellation is filtered. Hidden source-map upload is configurable with build-only credentials.
- Bounded error fingerprint aggregation, asynchronous alert production and an authenticated HTTPS intake client with bounded retries. Reporting failure does not replace the business result.
- Optional loopback alert worker, private disk spool, signed Lark adapter, duplicate aggregation, bounded delivery batches, exponential retry and inspectable dead records. Tests use fake transports. Delivery is at-least-once, not lossless or exactly-once.
- Pipeline alert metrics use latest prices per asset, exclude fixed-USD prices from provider expiry monitoring, allow a short expiry grace interval, and distinguish busy database connections from idle pooled connections.
- Blank configuration template, setup runbook, unapplied systemd and log-retention templates; public environment-variable checks reject notification and Sentry auth secrets.

## Local verification

| Check | Result |
| --- | --- |
| Backend full test command, including generated/type/packaging checks | Passed; 203 unit tests |
| Backend build | Passed |
| Frontend full test command | Passed; 634 tests |
| Frontend production build, resource budgets, lazy-loading boundaries and SEO generation | Passed |
| Environment and deployment-boundary tests | Passed; 23 tests |
| Focused observability tests | Passed; 17 tests, included in relevant suites above |

The optional browser Sentry module is approximately 88.41 KB / 29.91 KB gzip in the local build. Without a configured browser DSN, the application does not load it. No UI components were added.

## Remaining activation and acceptance

1. Create Sentry projects and supply environment-scoped DSNs plus build-only source-map upload configuration. Verify actual event delivery, release association, symbolication and absence of publicly accessible source maps.
2. Create the Lark bot with signature verification. Supply its webhook and signing secret in a protected local file or secret manager; configure an independently generated intake token. Configure HTTPS intake and environment-specific alert processes before authorized delivery testing.
3. Select and deploy independent health monitoring and off-host log retention. Automatic sustained-health/recovery evaluation, Vercel log drains, relay log collection and VPS rotation remain operational follow-up work. A same-host reporting module cannot detect and deliver its own host outage reliably.
4. Web RPC and market-page server functions currently emit sanitized structured Vercel logs; their remote error delivery still requires a drain or additional server SDK integration. Not every legacy logging statement has been replaced.
5. Use normal test-then-production deployment gates. This implementation neither applies infrastructure templates nor changes production runtime settings.

See [setup runbook](../runbooks/OBSERVABILITY_SETUP.md) and [baseline audit](LOGGING_OBSERVABILITY_AUDIT_2026-09-18.md). Configuration template: `config/observability.env.example`. Do not place credentials in review documents or chat.
