import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { createContentApp } from '../apps/content/src/index.ts';
import { createPipelineApp } from '../apps/pipeline/src/index.ts';
import { createReadApiApp } from '../apps/read-api/src/index.ts';

type Service = 'read-api' | 'pipeline' | 'content';

const service = process.argv[2] as Service | undefined;
if (!service || !['read-api', 'pipeline', 'content'].includes(service)) {
  throw new Error('Usage: node --experimental-strip-types scripts/serve.ts <read-api|pipeline|content>');
}

const app = service === 'read-api' ? createReadApiApp() : service === 'pipeline' ? createPipelineApp() : createContentApp();
const port = parsePort(process.env[service === 'read-api' ? 'TG_READ_API_PORT' : service === 'pipeline' ? 'TG_PIPELINE_PORT' : 'TG_CONTENT_PORT'],
  service === 'read-api' ? 8787 : service === 'pipeline' ? 8788 : 8789);
const host = '127.0.0.1';

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = nodeRequest(incoming, port);
    const response = await app.fetch(request);
    await writeResponse(response, outgoing);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'local_server_error', service, error: error instanceof Error ? error.name : 'UnknownError' }));
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ error: 'internal_error' }));
  }
});

server.on('error', (error) => {
  console.error(JSON.stringify({ level: 'error', event: 'local_server_listen_error', service, error: error.name }));
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.info(JSON.stringify({ level: 'info', event: 'local_server_started', service, origin: `http://${host}:${port}`, runtime: process.version }));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) throw new Error('Local service port must be an integer between 1 and 65535');
  const value = Number(raw);
  if (value > 65_535) throw new Error('Local service port must be an integer between 1 and 65535');
  return value;
}

function nodeRequest(incoming: IncomingMessage, port: number): Request {
  const authority = incoming.headers.host ?? `127.0.0.1:${port}`;
  const url = new URL(incoming.url ?? '/', `http://${authority}`);
  const method = incoming.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(incoming);
  return new Request(url, {
    method,
    headers: incoming.headers as HeadersInit,
    ...(body ? { body, duplex: 'half' } : {}),
  } as RequestInit);
}

async function writeResponse(response: Response, outgoing: ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (getSetCookie) {
    const cookies = getSetCookie.call(response.headers);
    if (cookies.length > 0) headers['set-cookie'] = cookies;
  }
  outgoing.writeHead(response.status, headers);
  if (!response.body) {
    outgoing.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(response.body as never).once('error', reject).once('end', resolve).pipe(outgoing);
  });
}
