import { performance } from 'node:perf_hooks';

const required = ['TG_PREVIEW_READ_API_URL', 'TG_PREVIEW_PIPELINE_URL', 'TG_PREVIEW_CONTENT_URL', 'TG_PREVIEW_ALLOWED_ORIGIN'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing Preview acceptance environment: ${missing.join(', ')}`);
}

function origin(key) {
  const parsed = new URL(process.env[key]);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${key} must be a credential-free HTTPS origin`);
  }
  return parsed.origin;
}

const targets = {
  'read-api': origin('TG_PREVIEW_READ_API_URL'),
  pipeline: origin('TG_PREVIEW_PIPELINE_URL'),
  content: origin('TG_PREVIEW_CONTENT_URL'),
};
const allowedOrigin = origin('TG_PREVIEW_ALLOWED_ORIGIN');
const evidence = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  runtime: process.version,
  targets: {},
  checks: [],
};
const failures = [];

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

async function request(check, url, init, expectedStatus) {
  const started = performance.now();
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  } catch (error) {
    failures.push(`${check}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  const record = {
    check,
    status: response.status,
    expectedStatus,
    durationMs,
    requestId: response.headers.get('x-request-id'),
    vercelCache: response.headers.get('x-vercel-cache'),
  };
  evidence.checks.push(record);
  if (response.status !== expectedStatus) failures.push(`${check}: expected ${expectedStatus}, received ${response.status}`);
  return response;
}

for (const [service, baseUrl] of Object.entries(targets)) {
  evidence.targets[service] = new URL(baseUrl).hostname;
  const live = await request(`${service}:live`, `${baseUrl}/internal/live`, {}, 200);
  if (live) {
    const body = await live.json().catch(() => null);
    if (body?.service !== service || body?.status !== 'live') failures.push(`${service}:live returned an invalid body`);
  }
  const ready = await request(`${service}:ready`, `${baseUrl}/internal/ready`, {}, 200);
  if (ready) {
    const body = await ready.json().catch(() => null);
    if (body?.service !== service || body?.status !== 'ready') failures.push(`${service}:ready returned an invalid body`);
  }
}

const cors = await request('read-api:cors-allowed', `${targets['read-api']}/health`, {
  method: 'OPTIONS',
  headers: { origin: allowedOrigin, 'access-control-request-method': 'GET' },
}, 204);
if (cors?.headers.get('access-control-allow-origin') !== allowedOrigin) failures.push('read-api:cors-allowed did not reflect the exact origin');

const rejectedOrigin = 'https://origin-that-must-not-be-allowed.invalid';
const denied = await request('read-api:cors-denied', `${targets['read-api']}/health`, {
  method: 'OPTIONS',
  headers: { origin: rejectedOrigin, 'access-control-request-method': 'GET' },
}, 403);
if (denied?.headers.has('access-control-allow-origin')) failures.push('read-api:cors-denied exposed an allow-origin header');

await request('read-api:mutation-denied', `${targets['read-api']}/internal/live`, { method: 'POST' }, 405);
await request('pipeline:forged-webhook-denied', `${targets.pipeline}/v1/webhooks/alchemy`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-alchemy-signature': '0'.repeat(64) },
  body: '{}',
}, 401);

const concurrencyStarted = performance.now();
const concurrentResponses = await Promise.all(Array.from({ length: 10 }, (_, index) => request(
  `read-api:concurrent-live:${index + 1}`,
  `${targets['read-api']}/internal/live`,
  { headers: { 'x-request-id': `preview-acceptance-${index + 1}` } },
  200,
)));
const concurrentDurations = evidence.checks.filter((item) => item.check.startsWith('read-api:concurrent-live:')).map((item) => item.durationMs);
evidence.concurrency = {
  requests: concurrentResponses.length,
  wallMs: Math.round((performance.now() - concurrencyStarted) * 100) / 100,
  p50Ms: percentile(concurrentDurations, 0.5),
  p95Ms: percentile(concurrentDurations, 0.95),
};
evidence.status = failures.length === 0 ? 'passed' : 'failed';
evidence.failures = failures;

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
