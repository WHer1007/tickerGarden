import { randomUUID, timingSafeEqual } from 'node:crypto';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';

export type ServiceKind = 'read-api' | 'content' | 'pipeline';

export interface ServiceConfig {
  readonly environment: 'development' | 'preview' | 'production' | 'test';
  readonly allowedOrigins: readonly string[];
  readonly maxBodyBytes: number;
  readonly ready: boolean;
  readonly readinessReasons: readonly string[];
}

export interface ServiceOptions {
  readonly kind: ServiceKind;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly requiredEnvironmentKeys?: readonly string[];
  readonly maxBodyBytes?: number;
}

export type ServiceApp = OpenAPIHono<{ Variables: { requestId: string } }>;

const ErrorBody = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().uuid(),
});

const StatusBody = z.object({
  service: z.enum(['read-api', 'content', 'pipeline']),
  status: z.enum(['live', 'ready', 'not_ready']),
  requestId: z.string().uuid(),
  reasons: z.array(z.string()).optional(),
});

function normalizeOrigin(raw: string): string {
  const value = raw.trim();
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`Invalid allowed origin: ${raw}`);
  }
  return parsed.origin;
}

export function readServiceConfig(options: ServiceOptions): ServiceConfig {
  const env = options.env ?? process.env;
  const rawEnvironment = env.VERCEL_ENV ?? env.NODE_ENV ?? 'development';
  const environment = rawEnvironment === 'production' || rawEnvironment === 'preview' || rawEnvironment === 'test'
    ? rawEnvironment
    : 'development';
  const allowedOrigins = Object.freeze((env.TG_ALLOWED_ORIGINS ?? '')
    .split(',')
    .filter(Boolean)
    .map(normalizeOrigin));
  const readinessReasons = (options.requiredEnvironmentKeys ?? [])
    .filter((key) => !env[key])
    .map((key) => `${key} is missing`);
  if ((environment === 'production' || environment === 'preview') && allowedOrigins.length === 0 && options.kind !== 'pipeline') {
    readinessReasons.push('TG_ALLOWED_ORIGINS is missing');
  }
  return Object.freeze({
    environment,
    allowedOrigins,
    maxBodyBytes: options.maxBodyBytes ?? 64 * 1024,
    ready: readinessReasons.length === 0,
    readinessReasons: Object.freeze(readinessReasons),
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createServiceApp(options: ServiceOptions): ServiceApp {
  const config = readServiceConfig(options);
  const app = new OpenAPIHono<{ Variables: { requestId: string } }>();

  app.use('*', secureHeaders());
  app.use('*', async (context, next) => {
    const incoming = context.req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    context.set('requestId', requestId);
    context.header('x-request-id', requestId);
    await next();
  });
  app.use('*', async (context, next) => {
    const started = performance.now();
    await next();
    console.info(JSON.stringify({
      level: 'info', event: 'http_request', service: options.kind, environment: config.environment,
      requestId: context.get('requestId'), method: context.req.method,
      path: new URL(context.req.url).pathname.replace(/0x[0-9a-fA-F]{40,64}/g, ':id'),
      status: context.res.status, durationMs: Math.round((performance.now() - started) * 100) / 100,
      requestBytes: Number(context.req.header('content-length') ?? 0) || 0,
    }));
  });
  app.use('*', bodyLimit({
    maxSize: config.maxBodyBytes,
    onError: (context) => context.json({ error: 'request_too_large', message: 'Request body is too large', requestId: context.get('requestId') }, 413),
  }));
  app.use('*', async (context, next) => {
    const allowed = options.kind === 'read-api'
      ? ['GET', 'HEAD', 'OPTIONS']
      : ['GET', 'POST', 'HEAD', 'OPTIONS'];
    if (!allowed.includes(context.req.method)) {
      context.header('allow', allowed.join(', '));
      context.header('cache-control','no-store');
      return context.json({ error: 'method_not_allowed', message: 'Method is not allowed', requestId: context.get('requestId') }, 405);
    }
    await next();
  });
  app.use('*', async (context, next) => {
    const origin = context.req.header('origin');
    context.header('vary', 'Origin');
    if (origin && config.allowedOrigins.includes(origin)) {
      context.header('access-control-allow-origin', origin);
      context.header('vary', 'Origin');
      context.header('access-control-allow-methods', options.kind === 'read-api' ? 'GET, OPTIONS' : 'GET, POST, OPTIONS');
      context.header('access-control-allow-headers', 'Authorization, Content-Type, X-Request-Id, X-Alchemy-Signature, X-Upload-Nonce, X-Upload-Signature');
      context.header('access-control-max-age', '600');
    }
    if (context.req.method === 'OPTIONS') {
      if (!origin || !config.allowedOrigins.includes(origin)) {
        return context.json({ error: 'origin_not_allowed', message: 'Origin is not allowed', requestId: context.get('requestId') }, 403);
      }
      return context.body(null, 204);
    }
    await next();
    // Origin-less reads must not seed shared caches with a response browsers cannot read.
    if (!origin || !config.allowedOrigins.includes(origin)) {
      context.header('cache-control', 'no-store');
    }
  });

  app.openapi(createRoute({
    method: 'get', path: '/internal/live',
    responses: { 200: { content: { 'application/json': { schema: StatusBody } }, description: 'Function is live' } },
  }), (context) => context.json({ service: options.kind, status: 'live' as const, requestId: context.get('requestId') }, 200));

  app.openapi(createRoute({
    method: 'get', path: '/internal/ready',
    responses: {
      200: { content: { 'application/json': { schema: StatusBody } }, description: 'Dependencies configured' },
      503: { content: { 'application/json': { schema: StatusBody } }, description: 'Dependencies unavailable' },
    },
  }), (context) => config.ready
    ? context.json({ service: options.kind, status: 'ready' as const, requestId: context.get('requestId') }, 200)
    : context.json({ service: options.kind, status: 'not_ready' as const, requestId: context.get('requestId'), reasons: [...config.readinessReasons] }, 503));

  app.doc('/internal/openapi.json', {
    openapi: '3.1.0',
    info: { title: `TickerGarden ${options.kind}`, version: '0.0.0' },
  });
  app.notFound((context) => context.json({ error: 'not_found', message: 'Route not found', requestId: context.get('requestId') }, 404));
  app.onError((error, context) => {
    console.error(JSON.stringify({ level: 'error', service: options.kind, requestId: context.get('requestId'), error: error.name }));
    return context.json({ error: 'internal_error', message: 'Internal server error', requestId: context.get('requestId') }, 500);
  });
  return app;
}

export { ErrorBody, StatusBody, constantTimeEqual };
