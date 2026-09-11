const ALLOWED_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
]);

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type RpcEnvironment = Readonly<Record<string, string | undefined>>;

export async function proxyReadRpc(
  request: Request,
  environment: RpcEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const headers = { 'cache-control': 'no-store', 'content-type': 'application/json' };
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);
  if (!sameOrigin(request)) return json({ error: 'origin_not_allowed' }, 403, headers);

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_REQUEST_BYTES) {
    return json({ error: 'request_too_large' }, 413, headers);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return json({ error: 'request_too_large' }, 413, headers);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'invalid_json_rpc' }, 400, headers); }
  if (!validPayload(payload)) return json({ error: 'invalid_json_rpc' }, 400, headers);
  if (!ALLOWED_METHODS.has(payload.method)) return json({ error: 'rpc_method_not_allowed' }, 403, headers);

  const upstream = rpcUrl(environment.TG_WEB_RPC_URL);
  if (!upstream) return json({ error: 'rpc_upstream_unavailable' }, 503, headers);
  try {
    const response = await fetcher(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return json({ error: 'rpc_upstream_unavailable' }, 502, headers);
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) return json({ error: 'rpc_response_too_large' }, 502, headers);
    try { JSON.parse(body); } catch { return json({ error: 'rpc_upstream_invalid_response' }, 502, headers); }
    return new Response(body, { status: 200, headers });
  } catch {
    return json({ error: 'rpc_upstream_unavailable' }, 502, headers);
  }
}

function validPayload(value: unknown): value is { readonly jsonrpc: '2.0'; readonly id: string | number | null; readonly method: string; readonly params: readonly unknown[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const id = item.id;
  return item.jsonrpc === '2.0'
    && typeof item.method === 'string'
    && Array.isArray(item.params)
    && (id === null || typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id)));
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function rpcUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.toString() : null;
  } catch { return null; }
}

function json(value: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

export default {
  fetch(request: Request): Promise<Response> {
    return proxyReadRpc(request, process.env);
  },
};
