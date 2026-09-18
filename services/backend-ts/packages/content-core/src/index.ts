import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { recoverMessageAddress } from 'viem';
import { transaction } from '../../db/src/index.ts';
import { enqueueReliableMessage } from '../../jobs/src/index.ts';

type Address = `0x${string}`; type Hash = `0x${string}`;
export interface ImageDescriptor { readonly digest: Hash; readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; readonly byteLength: number;
  readonly width: number; readonly height: number; readonly extension: 'png' | 'jpg' | 'webp'; readonly bytes: Buffer }
export interface LaunchMetadataInput { readonly name: string; readonly symbol: string; readonly description: string; readonly x: string | null;
  readonly website: string | null; readonly creatorFeesToHolders: boolean; readonly creatorTaxBps: number; readonly image: ImageDescriptor | null }

export function uploadMessage(origin: string, chainId: number, challenge: { account: Address; digest: string; nonce: string; expires: number }): string {
  return `TickerGarden Metadata Upload\nOrigin: ${origin}\nChain ID: ${chainId}\nWallet: ${challenge.account}\nContent SHA-256: ${challenge.digest}\nNonce: ${challenge.nonce}\nExpires: ${challenge.expires}\nAuthorize one metadata upload. No transaction or token approval.`;
}

export async function createContentChallenge(input: { readonly pool: Pool; readonly account: Address; readonly digest: string; readonly origin: string;
  readonly expectedOrigin: string; readonly chainId: number; readonly schemaName?: string; readonly now?: Date }) {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); const now = input.now ?? new Date();
  if (input.origin !== input.expectedOrigin || !strictOrigin(input.origin) || !/^0x[0-9a-f]{40}$/.test(input.account) || /^0x0{40}$/.test(input.account)
    || !/^[0-9a-f]{64}$/.test(input.digest)) throw new Error('invalid content challenge');
  const recent = await input.pool.query(`SELECT count(*)::int AS count FROM ${schema}.content_challenges WHERE account=$1 AND created_at>$2`,
    [input.account, new Date(now.getTime() - 60_000)]);
  if (Number(recent.rows[0]?.count ?? 0) >= 5) throw new ContentQuotaError();
  const nonce = randomBytes(32).toString('hex'); const expires = Math.floor(now.getTime() / 1000) + 300;
  await input.pool.query(`INSERT INTO ${schema}.content_challenges(nonce,account,content_digest,origin,expires_at) VALUES($1,$2,$3,$4,to_timestamp($5))`,
    [nonce, input.account, `0x${input.digest}`, input.origin, expires]);
  return { nonce, account: input.account, chainId: input.chainId, digest: input.digest, expires,
    message: uploadMessage(input.origin, input.chainId, { account: input.account, digest: input.digest, nonce, expires }) };
}

export async function createContentUpload(input: { readonly pool: Pool; readonly rawBody: string; readonly nonce: string; readonly signature: `0x${string}`;
  readonly origin: string; readonly expectedOrigin: string; readonly chainId: number; readonly sessionSecret: string; readonly schemaName?: string; readonly now?: Date }) {
  if (Buffer.byteLength(input.rawBody) > 3 * 1024 * 1024 || input.origin !== input.expectedOrigin || !strictOrigin(input.origin)
    || !/^[0-9a-f]{64}$/.test(input.nonce) || !/^0x[0-9a-fA-F]{130}$/.test(input.signature) || input.sessionSecret.length < 32) throw new ContentAuthorizationError();
  const digest = sha256(Buffer.from(input.rawBody)); const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const challenge = (await input.pool.query<{ account: Address; content_digest: Hash; origin: string; expires: string; used: boolean }>(
    `SELECT account,content_digest,origin,extract(epoch from expires_at)::bigint AS expires,used FROM ${schema}.content_challenges WHERE nonce=$1`, [input.nonce])).rows[0];
  if (!challenge || challenge.content_digest !== digest || challenge.origin !== input.origin || Number(challenge.expires) <= Math.floor((input.now ?? new Date()).getTime() / 1000)) throw new ContentAuthorizationError();
  const message = uploadMessage(input.origin, input.chainId, { account: challenge.account, digest: digest.slice(2), nonce: input.nonce, expires: Number(challenge.expires) });
  const recovered = (await recoverMessageAddress({ message, signature: input.signature })).toLowerCase();
  if (recovered !== challenge.account) throw new ContentAuthorizationError();
  const metadata = parseLaunchMetadata(input.rawBody); const operationDigest = sha256(`${challenge.account}:${digest}`);
  const row = await transaction(input.pool, async (client) => {
    // Serialize the absent-row case too. Each failed attempt retains its own
    // upload ID and queue identity; an old delivery cannot mutate the retry.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`content-upload:${operationDigest}`]);
    const prior = (await client.query<{ upload_id: string; payload: Record<string, unknown>; status: string }>(
      `SELECT upload_id,payload,status FROM ${schema}.content_uploads WHERE operation_digest=$1 FOR UPDATE`, [operationDigest])).rows[0];
    if (prior && prior.status !== 'failed') return prior;
    const consumed = await client.query(`UPDATE ${schema}.content_challenges SET used=true WHERE nonce=$1 AND NOT used AND expires_at>now()`, [input.nonce]);
    if (consumed.rowCount !== 1) throw new ContentAuthorizationError();
    if (prior) await client.query(`UPDATE ${schema}.content_uploads SET operation_digest=$2,updated_at=now() WHERE upload_id=$1 AND status='failed'`,
      [prior.upload_id, sha256(`${operationDigest}:failed:${prior.upload_id}`)]);
    const uploadId = randomUUID(); const objectKey = metadata.image ? `uploads/${uploadId}/${metadata.image.digest.slice(2)}.${metadata.image.extension}` : null;
    const payload = { metadata: withoutImage(metadata), image: metadata.image ? { digest: metadata.image.digest, mediaType: metadata.image.mediaType,
      byteLength: metadata.image.byteLength, width: metadata.image.width, height: metadata.image.height, objectKey } : null };
    const status = metadata.image ? 'awaiting_upload' : 'uploaded';
    const inserted = (await client.query<{ upload_id: string; payload: Record<string, unknown>; status: string }>(`INSERT INTO ${schema}.content_uploads
      (upload_id,operation_digest,owner,origin,content_digest,access_token_digest,image_digest,image_media_type,image_byte_length,image_object_key,status,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING upload_id,payload,status`, [uploadId, operationDigest, challenge.account, input.origin, digest,
      tokenDigest(sessionToken(input.sessionSecret, uploadId)), metadata.image?.digest ?? null, metadata.image?.mediaType ?? null, metadata.image?.byteLength ?? null,
      objectKey, status, payload])).rows[0];
    return inserted!;
  });
  const token = sessionToken(input.sessionSecret, row.upload_id); const image = row.payload.image as null | { objectKey: string; mediaType: string; byteLength: number; digest: string };
  return { uploadId: row.upload_id, accessToken: token, status: row.status, image, imageBytes: metadata.image?.bytes ?? null };
}

export async function completeContentUpload(input: { readonly pool: Pool; readonly uploadId: string; readonly accessToken: string; readonly objectVersion?: string;
  readonly sessionSecret: string; readonly generation?: bigint; readonly schemaName?: string }): Promise<{ status: string; duplicate: boolean }> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); await authorizeSession(input.pool, schema, input.uploadId, input.accessToken);
  const changed = await input.pool.query(`UPDATE ${schema}.content_uploads SET status='uploaded',image_object_version=COALESCE($2,image_object_version),updated_at=now()
    WHERE upload_id=$1 AND status='awaiting_upload'`, [input.uploadId, input.objectVersion ?? null]);
  const row = (await input.pool.query<{ status: string }>(`SELECT status FROM ${schema}.content_uploads WHERE upload_id=$1`, [input.uploadId])).rows[0];
  if (!row || row.status === 'failed') throw new ContentUploadStateError();
  const rawBody = JSON.stringify({ uploadId: input.uploadId });
  const generation = input.generation ?? 0n;
  const enqueued = await enqueueReliableMessage(input.pool, { queue: 'content', externalId: `g${generation}:upload-${input.uploadId}`,
    operationId: `g${generation}:content-${input.uploadId}`, kind: 'content-publish', rawBody, payload: { uploadId: input.uploadId },
    destinationKey: 'content-worker', maxAttempts: 16, generation }, input.schemaName);
  return { status: row.status, duplicate: changed.rowCount === 0 || enqueued.duplicate };
}

export async function readContentUpload(input: { readonly pool: Pool; readonly uploadId: string; readonly accessToken: string; readonly schemaName?: string }) {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const row = await authorizeSession(input.pool, schema, input.uploadId, input.accessToken);
  return { uploadId: input.uploadId, status: row.status, metadataURI: row.metadata_cid ? `ipfs://${row.metadata_cid}` : null,
    metadata: row.payload.publishedMetadata ?? null, error: row.error_code ?? null };
}

async function authorizeSession(pool: Pool, schema: string, uploadId: string, token: string) {
  if (!/^[0-9a-f-]{36}$/.test(uploadId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ContentAuthorizationError();
  const row = (await pool.query<{ access_token_digest: Hash; status: string; metadata_cid: string | null; error_code: string | null; payload: Record<string, unknown> }>(
    `SELECT access_token_digest,status,metadata_cid,error_code,payload FROM ${schema}.content_uploads WHERE upload_id=$1`, [uploadId])).rows[0];
  if (!row || !safeEqual(row.access_token_digest, tokenDigest(token))) throw new ContentAuthorizationError(); return row;
}

export function parseLaunchMetadata(raw: string): LaunchMetadataInput {
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error('invalid metadata JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid metadata object'); const record = value as Record<string, unknown>;
  const allowed = new Set(['name', 'symbol', 'description', 'x', 'website', 'creatorFeesToHolders', 'creatorTaxBps', 'image']);
  if (Object.keys(record).some((key) => !allowed.has(key)) || typeof record.name !== 'string' || record.name.length < 1 || record.name.length > 64 || record.name.trim() !== record.name
    || typeof record.symbol !== 'string' || !/^[A-Z0-9]{1,16}$/.test(record.symbol) || typeof record.description !== 'string' || record.description.length > 300
    || record.description.trim() !== record.description || typeof record.creatorFeesToHolders !== 'boolean' || !Number.isInteger(record.creatorTaxBps)
    || Number(record.creatorTaxBps) < 0 || Number(record.creatorTaxBps) > 500) throw new Error('invalid launch metadata fields');
  return { name: record.name, symbol: record.symbol, description: record.description, x: normalizeX(record.x), website: normalizeWebsite(record.website),
    creatorFeesToHolders: record.creatorFeesToHolders, creatorTaxBps: Number(record.creatorTaxBps), image: parseImage(record.image) };
}
function parseImage(value: unknown): ImageDescriptor | null {
  if (value === undefined || value === '') return null; if (typeof value !== 'string') throw new Error('invalid image');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value); if (!match) throw new Error('invalid image data URI');
  const bytes = Buffer.from(match[2]!, 'base64'); if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== match[2]) throw new Error('invalid image size');
  const mediaType = match[1] as ImageDescriptor['mediaType']; return inspectImage(bytes, mediaType);
}
export function inspectImage(bytes: Buffer, mediaType: ImageDescriptor['mediaType']): ImageDescriptor {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('invalid image size');
  const dimensions = imageDimensions(bytes, mediaType);
  if (dimensions.width > 4096 || dimensions.height > 4096 || dimensions.width * dimensions.height > 4096 * 4096) throw new Error('invalid image dimensions');
  return { digest: sha256(bytes), mediaType, byteLength: bytes.length, ...dimensions, extension: mediaType === 'image/jpeg' ? 'jpg' : mediaType.slice(6) as 'png' | 'webp', bytes };
}
function imageDimensions(bytes: Buffer, type: ImageDescriptor['mediaType']): { width: number; height: number } {
  if (type === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return positive(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  if (type === 'image/webp' && bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const kind = bytes.toString('ascii', 12, 16); if (kind === 'VP8X') return positive(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3));
  }
  if (type === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2; while (offset + 9 < bytes.length) { if (bytes[offset] !== 0xff) throw new Error('invalid JPEG'); const marker = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2); if (length < 2 || offset + length + 2 > bytes.length) throw new Error('invalid JPEG');
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return positive(bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)); offset += 2 + length; }
  }
  throw new Error('image payload does not match media type');
}
function positive(width: number, height: number) { if (width <= 0 || height <= 0) throw new Error('invalid image dimensions'); return { width, height } }
function normalizeX(value: unknown): string | null { if (value === undefined || value === null || value === '') return null; if (typeof value !== 'string' || value.length > 200 || value.trim() !== value) throw new Error('invalid X link');
  const handle = value.replace(/^@/, ''); if (/^[A-Za-z0-9_]{1,64}$/.test(handle)) return `https://x.com/${handle}`; const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (url.protocol !== 'https:' || !['x.com','twitter.com'].includes(url.hostname.toLowerCase()) || url.port || url.search || url.hash || !/^\/[A-Za-z0-9_]{1,64}\/?$/.test(url.pathname)) throw new Error('invalid X link'); return `https://${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '')}` }
function normalizeWebsite(value: unknown): string | null { if (value === undefined || value === null || value === '') return null; if (typeof value !== 'string' || value.length > 512 || value.trim() !== value) throw new Error('invalid website');
  const url = new URL(value); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid website'); if (!url.pathname) url.pathname = '/'; return url.toString() }
function withoutImage(value: LaunchMetadataInput) { return { name: value.name, symbol: value.symbol, description: value.description, x: value.x, website: value.website,
  creatorFeesToHolders: value.creatorFeesToHolders, creatorTaxBps: value.creatorTaxBps } }
function sessionToken(secret: string, uploadId: string): string { return createHmac('sha256', secret).update(`content-upload-v1:${uploadId}`).digest('base64url') }
function tokenDigest(value: string): Hash { return sha256(value) }
function sha256(value: string | Buffer): Hash { return `0x${createHash('sha256').update(value).digest('hex')}` }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b) }
function strictOrigin(value: string): boolean { try { const url = new URL(value); return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
    && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) && url.origin === value; } catch { return false } }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"` }
export class ContentAuthorizationError extends Error { override readonly name = 'ContentAuthorizationError' }
export class ContentQuotaError extends Error { override readonly name = 'ContentQuotaError' }

export class ContentUploadStateError extends Error { constructor(){super("Upload session cannot be completed");this.name="ContentUploadStateError";} }
