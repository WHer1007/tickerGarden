import type {Pool} from 'pg';
import {displaySchema} from './worker.ts';

export interface PublicMarketContent {
  readonly description: string;
  readonly imageURI: string | null;
  readonly website: string | null;
  readonly x: string | null;
}

type ContentMarket = {readonly identity?: {readonly metadataURI?: unknown} | null};
const cidPattern = '(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})';
const metadataUriPattern = new RegExp(`^ipfs://(${cidPattern})$`);
const imageUriPattern = new RegExp(`^ipfs://${cidPattern}(?:/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*$`);

/** Read only the public metadata object associated with a published market URI. */
export async function publicMarketContent(
  pool: Pick<Pool, 'query'>,
  market: ContentMarket,
  schemaName?: string,
): Promise<PublicMarketContent | null> {
  const uri = market.identity?.metadataURI;
  if (typeof uri !== 'string') return null;
  const match = metadataUriPattern.exec(uri);
  if (!match) return null;

  const schema = displaySchema(schemaName);
  const payload = (await pool.query<{payload: unknown}>(
    `SELECT payload FROM ${schema}.content_objects
     WHERE cid=$1 AND status='ready' AND media_type='application/json' LIMIT 1`,
    [match[1]],
  )).rows[0]?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const metadata = payload as Record<string, unknown>;
  const properties = metadata.properties && typeof metadata.properties === 'object' && !Array.isArray(metadata.properties)
    ? metadata.properties as Record<string, unknown>
    : {};
  return {
    description: typeof metadata.description === 'string' && metadata.description.length <= 10_000 ? metadata.description : '',
    imageURI: typeof metadata.image === 'string' && imageUriPattern.test(metadata.image) ? metadata.image : null,
    website: safeExternalLink(properties.website ?? metadata.external_url),
    x: safeExternalLink(properties.x),
  };
}

function safeExternalLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
