import { isIP } from 'node:net';

export interface MetadataPolicy {
  readonly allowedOrigins: readonly string[];
  readonly ipfsGatewayOrigin?: string;
  readonly timeoutMs?: number;
  readonly maximumBytes?: number;
  readonly fetch?: typeof fetch;
}

export interface DisplayMetadata {
  readonly name?: string; readonly description?: string; readonly image?: string; readonly website?: string; readonly externalUrl?: string;
}

export async function fetchDisplayMetadata(uri: string, policy: MetadataPolicy): Promise<DisplayMetadata> {
  const allowed = new Set(policy.allowedOrigins.map(strictOrigin));
  let url = metadataUrl(uri, policy.ipfsGatewayOrigin);
  const fetcher = policy.fetch ?? fetch;
  const maximumBytes = policy.maximumBytes ?? 256 * 1024;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1024 * 1024) throw new Error('metadata response bound is invalid');
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    assertAllowed(url, allowed);
    const response = await fetcher(url, { method: 'GET', redirect: 'manual', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(policy.timeoutMs ?? 4_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === 2) throw new Error('metadata redirect is invalid');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('metadata response is unavailable');
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > maximumBytes) throw new Error('metadata response exceeds size limit');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('metadata response has no body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); throw new Error('metadata response exceeds size limit'); }
      chunks.push(item.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('metadata JSON must be an object');
    const record = value as Record<string, unknown>;
    return Object.freeze({
      ...(boundedText(record.name, 256) ? { name: boundedText(record.name, 256)! } : {}),
      ...(boundedText(record.description, 4096) ? { description: boundedText(record.description, 4096)! } : {}),
      ...(safeDisplayUrl(record.image, allowed) ? { image: safeDisplayUrl(record.image, allowed)! } : {}),
      ...(safeDisplayUrl(record.website, allowed) ? { website: safeDisplayUrl(record.website, allowed)! } : {}),
      ...(safeDisplayUrl(record.external_url, allowed) ? { externalUrl: safeDisplayUrl(record.external_url, allowed)! } : {}),
    });
  }
  throw new Error('metadata redirect bound exceeded');
}

function metadataUrl(uri: string, gateway?: string): URL {
  if (uri.startsWith('ipfs://')) {
    if (!gateway || !/^ipfs:\/\/[A-Za-z0-9]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*$/.test(uri)) throw new Error('IPFS metadata URI is invalid or gateway is unavailable');
    const root = strictOrigin(gateway);
    return new URL(`/ipfs/${uri.slice(7)}`, `${root}/`);
  }
  return new URL(uri);
}
function strictOrigin(raw: string): string { const url = new URL(raw); if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || isIP(url.hostname)) throw new Error('metadata origin must be a public HTTPS hostname'); return url.origin; }
function assertAllowed(url: URL, allowed: ReadonlySet<string>): void { if (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname) || !allowed.has(url.origin)) throw new Error('metadata URL origin is not allowed'); }
function boundedText(value: unknown, maximum: number): string | undefined { return typeof value === 'string' && Buffer.byteLength(value) <= maximum ? value : undefined; }
function safeDisplayUrl(value: unknown, allowed: ReadonlySet<string>): string | undefined { if (typeof value !== 'string') return undefined; try { const url = new URL(value); assertAllowed(url, allowed); return url.toString(); } catch { return undefined; } }
