type RpcOutcome = 'succeeded' | 'failed';

/** Safe, low-cardinality RPC telemetry. Never include endpoint, params, or identifiers. */
export function rpcTelemetry(event: string, fields: Readonly<Record<string, string | number | boolean>>): void {
  try { console.info(JSON.stringify({ event, service:'web-rpc', time:new Date().toISOString(), ...fields })); } catch { /* telemetry cannot affect RPC behavior */ }
}

export function rpcBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function rpcElapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

export function rpcAttempt(method: string, role: 'primary' | 'fallback', started: number, requestBytes: number, responseBytes: number, outcome: RpcOutcome, status?: number, provider='unknown',attempt=1): void {
  rpcTelemetry('web_rpc_attempt', { method, role, provider, attempt, networkCalls:1, durationMs: rpcElapsed(started), requestBytes, responseBytes, outcome, ...(status === undefined ? {} : { status }) });
}

export function rpcProvider(url:string):string{const host=new URL(url).hostname;return host.endsWith('.quiknode.pro')?'quicknode':host.includes('alchemy')?'alchemy':'other';}
