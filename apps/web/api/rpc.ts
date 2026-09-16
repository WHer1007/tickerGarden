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
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
]);

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_SIZE = 20;

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
  const calls = Array.isArray(payload) ? payload : [payload];
  if (!calls.length || calls.length > MAX_BATCH_SIZE || !calls.every(validPayload) || !uniqueIds(calls)) {
    return json({ error: 'invalid_json_rpc' }, 400, headers);
  }
  if (calls.some(call => !ALLOWED_METHODS.has(call.method))) return json({ error: 'rpc_method_not_allowed' }, 403, headers);
  if (calls.some(call => !validReadScope(call))) return json({ error: 'invalid_json_rpc' }, 400, headers);

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

function validReadScope(call: { readonly method: string; readonly params?: readonly unknown[] }): boolean {
  if (call.method !== 'eth_getLogs') return true;
  const filter = call.params?.[0];
  if (call.params?.length !== 1 || !filter || typeof filter !== 'object' || Array.isArray(filter)) return false;
  const { address, fromBlock, toBlock, blockHash } = filter as Record<string, unknown>;
  if (blockHash !== undefined || typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  if (fromBlock === 'latest' && toBlock === 'latest') return true;
  if (typeof fromBlock !== 'string' || typeof toBlock !== 'string' || !/^0x[0-9a-fA-F]+$/.test(fromBlock) || !/^0x[0-9a-fA-F]+$/.test(toBlock)) return false;
  const from = BigInt(fromBlock), to = BigInt(toBlock);
  return to >= from && to - from <= 2_000n;
}

function validPayload(value: unknown): value is { readonly jsonrpc: '2.0'; readonly id: string | number | null; readonly method: string; readonly params?: readonly unknown[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const id = item.id;
  return item.jsonrpc === '2.0'
    && typeof item.method === 'string'
    // JSON-RPC 2.0 permits params to be omitted. Viem does this for reads such
    // as eth_blockNumber and eth_chainId, including inside HTTP batches.
    && (item.params === undefined || Array.isArray(item.params))
    && (id === null || typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id)));
}

function uniqueIds(calls: readonly { readonly id: string | number | null }[]): boolean {
  const ids = new Set<string>();
  for (const call of calls) {
    if (call.id === null) return false;
    const key = `${typeof call.id}:${String(call.id)}`;
    if (ids.has(key)) return false;
    ids.add(key);
  }
  return true;
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
