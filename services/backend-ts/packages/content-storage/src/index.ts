import { createHash, createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { inspectImage, type ImageDescriptor } from '../../content-core/src/index.ts';
import type { Lease } from '../../jobs/src/index.ts';

type Hash = `0x${string}`;
export interface S3Config { readonly bucket: string; readonly region: string; readonly accessKeyId: string; readonly secretAccessKey: string;
  readonly endpoint?: string; readonly sessionToken?: string; readonly fetch?: typeof fetch }

export function presignImagePut(config: S3Config, key: string, image: { mediaType: string; digest: string }, now = new Date()): { url: string; headers: Record<string, string> } {
  const host = endpoint(config).host; const path = objectPath(config, key); const date = amzDate(now); const day = date.slice(0, 8); const expires = 600;
  const headers = { 'content-type': image.mediaType, 'x-amz-meta-sha256': image.digest.slice(2) };
  const signedHeaders = 'content-type;host;x-amz-meta-sha256'; const scope = `${day}/${config.region}/s3/aws4_request`;
  const query = new URLSearchParams({ 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
    'X-Amz-Date': date, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': signedHeaders, ...(config.sessionToken ? { 'X-Amz-Security-Token': config.sessionToken } : {}) });
  query.sort(); const canonicalHeaders = `content-type:${image.mediaType}\nhost:${host}\nx-amz-meta-sha256:${image.digest.slice(2)}\n`;
  const canonical = `PUT\n${path}\n${query.toString()}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
  const signature = sign(config, day, createHash('sha256').update(canonical).digest('hex'), date);
  return { url: `${endpoint(config).origin}${path}?${query.toString()}&X-Amz-Signature=${signature}`, headers };
}

export async function getS3Object(config: S3Config, key: string): Promise<{ bytes: Buffer; version: string }> {
  const now = new Date(); const date = amzDate(now); const day = date.slice(0, 8); const host = endpoint(config).host; const path = objectPath(config, key);
  const payloadHash = createHash('sha256').update('').digest('hex'); const signedHeaders = config.sessionToken ? 'host;x-amz-content-sha256;x-amz-date;x-amz-security-token' : 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n${config.sessionToken ? `x-amz-security-token:${config.sessionToken}\n` : ''}`;
  const canonical = `GET\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`; const scope = `${day}/${config.region}/s3/aws4_request`;
  const signature = sign(config, day, createHash('sha256').update(canonical).digest('hex'), date);
  const response = await (config.fetch ?? fetch)(`${endpoint(config).origin}${path}`, { headers: { 'x-amz-date': date, 'x-amz-content-sha256': payloadHash,
    ...(config.sessionToken ? { 'x-amz-security-token': config.sessionToken } : {}), authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('S3 object is unavailable'); const declared = Number(response.headers.get('content-length') ?? '0'); if (declared > 2 * 1024 * 1024) throw new Error('S3 object exceeds size limit');
  const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 2 * 1024 * 1024) throw new Error('S3 object exceeds size limit');
  const version = response.headers.get('x-amz-version-id'); if (!version || version.length > 1024) throw new Error('S3 object version is unavailable'); return { bytes, version };
}

export async function publishContentJob(input: { readonly pool: Pool; readonly lease: Lease; readonly storage: S3Config; readonly pinataJwt: string;
  readonly pinataGroupId?: string; readonly schemaName?: string; readonly fetch?: typeof fetch }): Promise<string> {
  if (input.lease.kind !== 'content-publish' || typeof input.lease.payload.uploadId !== 'string') throw new Error('invalid content job');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); const uploadId = input.lease.payload.uploadId;
  const ready=await input.pool.query<{metadata_digest:string}>(`SELECT metadata_digest FROM ${schema}.content_uploads WHERE upload_id=$1 AND status='ready'`,[uploadId]);
  if(ready.rows[0]?.metadata_digest)return ready.rows[0].metadata_digest;
  const row = (await input.pool.query<{ owner: string; image_digest: Hash | null; image_media_type: ImageDescriptor['mediaType'] | null; image_byte_length: number | null;
    image_object_key: string | null; image_object_version: string | null; status: string; payload: { metadata: Record<string, unknown>; image: Record<string, unknown> | null } }>(
    `UPDATE ${schema}.content_uploads SET status='validating',updated_at=now() WHERE upload_id=$1 AND status IN ('uploaded','validating') RETURNING owner,image_digest,image_media_type,image_byte_length,image_object_key,image_object_version,status,payload`, [uploadId])).rows[0];
  if (!row) throw new Error('content upload is not ready for publication'); if (row.status === 'ready') return String(uploadId);
  try {
    let imageUri: string | null = null; let imageVersion: string | null = null;
    if (row.image_digest && row.image_media_type && row.image_object_key) {
      const object = await getS3Object(input.storage, row.image_object_key); const inspected = inspectImage(object.bytes, row.image_media_type);
      if (inspected.digest !== row.image_digest || inspected.byteLength !== row.image_byte_length
        || (row.image_object_version && row.image_object_version !== object.version)) throw new Error('uploaded image identity mismatch');
      imageVersion = object.version; imageUri = await pinFile(object.bytes, `${row.image_digest.slice(2)}.${inspected.extension}`, row.image_media_type, input);
      await input.pool.query(`INSERT INTO ${schema}.content_objects(digest,owner,media_type,byte_length,object_version,cid,status,payload)
        VALUES($1,$2,$3,$4,$5,$6,'ready',$7) ON CONFLICT (digest) DO UPDATE SET cid=excluded.cid,status='ready',object_version=excluded.object_version,payload=excluded.payload`,
      [row.image_digest, row.owner, row.image_media_type, inspected.byteLength, object.version, imageUri.slice(7), { width: inspected.width, height: inspected.height, objectKey: row.image_object_key }]);
    }
    const metadata = canonicalMetadata(row.payload.metadata, imageUri); const bytes = Buffer.from(JSON.stringify(metadata)); const metadataDigest = sha256(bytes);
    const metadataUri = await pinFile(bytes, `${metadataDigest.slice(2)}.json`, 'application/json', input);
    await input.pool.query(`UPDATE ${schema}.content_uploads SET status='ready',image_object_version=COALESCE($2,image_object_version),metadata_digest=$3,metadata_cid=$4,
      payload=jsonb_set(payload,'{publishedMetadata}',$5::jsonb,true),error_code=NULL,updated_at=now() WHERE upload_id=$1`,
      [uploadId, imageVersion, metadataDigest, metadataUri.slice(7), JSON.stringify(metadata)]);
    await input.pool.query(`INSERT INTO ${schema}.content_objects(digest,owner,media_type,byte_length,object_version,cid,status,payload)
      VALUES($1,$2,'application/json',$3,$4,$5,'ready',$6) ON CONFLICT (digest) DO UPDATE SET cid=excluded.cid,status='ready',payload=excluded.payload`,
      [metadataDigest, row.owner, bytes.length, metadataDigest, metadataUri.slice(7), metadata]);
    return metadataDigest;
  } catch (error) {
    // Keep transient provider/storage failures retryable. The durable job owns the
    // retry/dead transition; a single invocation must not terminally poison the
    // upload before QStash or the repair cron can redeliver it.
    await input.pool.query(`UPDATE ${schema}.content_uploads SET status='uploaded',error_code='metadata_publication_retry',updated_at=now() WHERE upload_id=$1`, [uploadId]); throw error;
  }
}

async function pinFile(bytes: Buffer, name: string, mediaType: string, input: { pinataJwt: string; pinataGroupId?: string; fetch?: typeof fetch }): Promise<string> {
  if (!input.pinataJwt) throw new Error('Pinata credential is unavailable'); const form = new FormData();
  form.append('file', new Blob([Uint8Array.from(bytes)], { type: mediaType }), name);
  form.append('network', 'public'); if (input.pinataGroupId) form.append('group_id', input.pinataGroupId);
  const response = await (input.fetch ?? fetch)('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { authorization: `Bearer ${input.pinataJwt}` }, body: form, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('IPFS upload rejected'); const body = await response.json() as { data?: { cid?: unknown; group_id?: unknown } }; const cid = body.data?.cid;
  if (typeof cid !== 'string' || !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})$/.test(cid)
    || (input.pinataGroupId && body.data?.group_id !== input.pinataGroupId)) throw new Error('invalid IPFS upload response'); return `ipfs://${cid}`;
}
function canonicalMetadata(source: Record<string, unknown>, image: string | null) { return { name: source.name, symbol: source.symbol, description: source.description,
  ...(image ? { image } : {}), ...(source.website ? { external_url: source.website } : {}), properties: { x: source.x ?? null, website: source.website ?? null,
    launch: { creatorFeesToHolders: source.creatorFeesToHolders, creatorTaxBps: source.creatorTaxBps } } } }
function endpoint(config: S3Config): URL { const raw = config.endpoint ?? `https://${config.bucket}.s3.${config.region}.amazonaws.com`; const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/') throw new Error('invalid S3 endpoint'); return url }
function objectPath(config: S3Config, key: string): string { if (!/^[A-Za-z0-9/_.-]{1,1024}$/.test(key) || key.includes('..')) throw new Error('invalid S3 object key');
  return config.endpoint ? `/${encodeURIComponent(config.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}` : `/${key.split('/').map(encodeURIComponent).join('/')}` }
function amzDate(value: Date): string { return value.toISOString().replace(/[:-]|\.\d{3}/g, '') }
function sign(config: S3Config, day: string, canonicalHash: string, date: string): string { const scope = `${day}/${config.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${canonicalHash}`; const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), 's3'), 'aws4_request'); return createHmac('sha256', key).update(stringToSign).digest('hex') }
function sha256(value: Buffer): Hash { return `0x${createHash('sha256').update(value).digest('hex')}` }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"` }
