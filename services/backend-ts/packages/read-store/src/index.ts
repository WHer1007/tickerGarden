import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';

export type Json = null | boolean | string | number | readonly Json[] | { readonly [key: string]: Json };

export interface SyncStatus {
  readonly chainId: 4663 | 46630;
  readonly status: 'synced' | 'lagging' | 'unavailable';
  readonly blockNumber: string | null;
  readonly blockHash: `0x${string}` | null;
  readonly finality: 'finalized' | 'unavailable';
  readonly headBlockNumber: string | null;
  readonly headBlockHash: `0x${string}` | null;
  readonly lagBlocks: string | null;
  readonly revision: string;
}

export class PublicationUnavailableError extends Error { override readonly name = 'PublicationUnavailableError'; }
export class PublicationChangedError extends Error { override readonly name = 'PublicationChangedError'; }

interface CursorPayload {
  readonly v: 1; readonly scope: string; readonly revision: string; readonly filterDigest: string; readonly sortKey: string; readonly identity: string;
}

export function encodeCursor(payload: Omit<CursorPayload, 'v'>, secret: string): string {
  assertCursorSecret(secret);
  const encoded = Buffer.from(JSON.stringify({ v: 1, ...payload })).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function decodeCursor(cursor: string, expected: { scope: string; revision: string; filterDigest: string }, secret: string): CursorPayload {
  assertCursorSecret(secret);
  const [encoded, signature, extra] = cursor.split('.');
  if (!encoded || !signature || extra) throw new PublicationChangedError('cursor is malformed');
  const expectedSignature = createHmac('sha256', secret).update(encoded).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new PublicationChangedError('cursor signature is invalid');
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw new PublicationChangedError('cursor payload is invalid'); }
  if (!payload || typeof payload !== 'object') throw new PublicationChangedError('cursor payload is invalid');
  const value = payload as Partial<CursorPayload>;
  if (value.v !== 1 || value.scope !== expected.scope || value.revision !== expected.revision || value.filterDigest !== expected.filterDigest
    || typeof value.sortKey !== 'string' || typeof value.identity !== 'string') throw new PublicationChangedError('cursor does not belong to this page');
  return value as CursorPayload;
}

export async function readPublishedPage(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly scope: string; readonly filter: Json;
  readonly secret: string; readonly revision?: string; readonly cursor?: string; readonly limit?: number; readonly schemaName?: string;
}): Promise<{ items: Json[]; nextCursor: string | null; sync: SyncStatus }> {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.scope)) throw new Error('invalid publication scope');
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const publication = await resolvePublication(input.pool, schema, input.deployment, input.scope, input.revision);
  const filterDigest = digest(input.filter);
  const after = input.cursor ? decodeCursor(input.cursor, { scope: input.scope, revision: publication.revision, filterDigest }, input.secret) : undefined;
  const records = await input.pool.query<{ identity: string; sort_key: string; payload: Json }>(
    `SELECT r.identity,r.sort_key,r.payload FROM ${schema}.projection_records r
     JOIN ${schema}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=$5
     WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope=$4 AND r.revision=$6
       AND b.canonical AND b.finalized
       AND ($7::text IS NULL OR (r.sort_key,r.identity)>($7,$8))
     ORDER BY r.sort_key,r.identity LIMIT $9`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope,
      publication.blockHash, publication.revision, after?.sortKey ?? null, after?.identity ?? null, limit + 1],
  );
  if (records.rows.length === 0 && after) {
    const stillCurrent = await isPublicationCanonical(input.pool, schema, input.deployment, input.scope, publication.revision);
    if (!stillCurrent) throw new PublicationChangedError('publication changed during pagination');
  }
  const visible = records.rows.slice(0, limit);
  const last = visible.at(-1);
  const nextCursor = records.rows.length > limit && last ? encodeCursor({
    scope: input.scope, revision: publication.revision, filterDigest, sortKey: last.sort_key, identity: last.identity,
  }, input.secret) : null;
  return { items: visible.map((row) => row.payload), nextCursor, sync: await syncForPublication(input.pool, schema, input.deployment, publication) };
}

export interface MarketPageFilter {
  readonly assetUid?: `0x${string}`;
  readonly marketId?: `0x${string}`;
  readonly memeToken?: `0x${string}`;
  readonly launchPhase?: 0 | 1;
  readonly search?: string;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly sort?: 'marketId_asc' | 'marketId_desc' | 'createdAt_asc' | 'createdAt_desc' | 'name_asc'
    | 'launchPhase_asc' | 'volume24hUsd_desc' | 'marketCapUsd_desc' | 'recentBuy_desc';
}

export async function readPublishedMarketPage(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly filter: MarketPageFilter; readonly secret: string;
  readonly includeRecent?: boolean; readonly revision?: string; readonly cursor?: string; readonly limit?: number; readonly schemaName?: string;
}): Promise<{ items: Json[]; nextCursor: string | null; sync: SyncStatus }> {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100');
  validateMarketFilter(input.filter);
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const publication = await resolvePublication(input.pool, schema, input.deployment, 'markets', input.revision);
  const canonicalFilter = marketFilterJson(input.filter);
  const recentVersion = input.includeRecent ? await readRecentMarketVersion(input) : undefined;
  const filterDigest = digest(input.includeRecent ? {filter:canonicalFilter,recentVersion:recentVersion??''} : canonicalFilter);
  const after = input.cursor ? decodeCursor(input.cursor, { scope: 'markets', revision: publication.revision, filterDigest }, input.secret) : undefined;
  const sort = marketSort(input.filter.sort ?? 'marketId_asc');
  if (after && after.sortKey !== 'n:' && !after.sortKey.startsWith('v:')) throw new PublicationChangedError('market cursor sort value is invalid');
  const cursorValue = after?.sortKey === undefined ? null : after.sortKey === 'n:' ? null : after.sortKey.slice(2);
  const cursorMissing = after?.sortKey === 'n:';
  const parameters: unknown[] = [
    input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, publication.blockHash, publication.revision,
    input.filter.assetUid ?? null, input.filter.marketId ?? null, input.filter.memeToken ?? null, input.filter.launchPhase ?? null,
    input.filter.search?.toLocaleLowerCase() ?? null, input.filter.createdFrom ?? null, input.filter.createdTo ?? null,
    after?.identity ?? null, cursorValue, limit + 1, cursorMissing,
  ];
  const afterClause = `AND ($13::text IS NULL
    OR ($16::boolean AND order_value IS NULL AND identity>$13)
    OR (NOT $16::boolean AND ((order_value IS NOT NULL AND (order_value ${sort.direction === 'ASC' ? '>' : '<'} $14::${sort.cast}
      OR (order_value=$14::${sort.cast} AND identity>$13))) OR order_value IS NULL)))`;
  const records = await input.pool.query<{ identity: string; payload: Json; order_text: string | null }>(
    `WITH market_rows AS (
       SELECT r.identity,r.payload FROM ${schema}.projection_records r
       JOIN ${schema}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=$4
       WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='markets' AND r.revision=$5 AND b.canonical AND b.finalized
       ${input.includeRecent ? `UNION ALL SELECT recent.market_id AS identity,recent.payload FROM ${schema}.recent_markets recent
       WHERE recent.environment=$1 AND recent.chain_id=$2 AND recent.deployment_digest=$3 AND recent.canonical AND recent.expires_at>now()
         AND recent.block_number>${publication.blockNumber}
         AND NOT EXISTS(SELECT 1 FROM ${schema}.projection_records existing WHERE existing.environment=$1 AND existing.chain_id=$2 AND existing.deployment_digest=$3 AND existing.scope='markets' AND existing.revision=$5 AND existing.identity=recent.market_id)` : ''}
     ), candidates AS (
       SELECT r.identity,r.payload,${sort.expression} AS order_value
       FROM market_rows r WHERE true
         AND ($6::text IS NULL OR r.payload->>'assetUid'=$6)
         AND ($7::text IS NULL OR r.payload->>'marketId'=$7)
         AND ($8::text IS NULL OR r.payload->>'memeToken'=$8)
         AND ($9::int IS NULL OR (r.payload->>'launchPhase')::int=$9)
         AND ($10::text IS NULL OR lower(concat_ws(' ',r.payload->>'marketId',r.payload->'identity'->>'name',r.payload->'identity'->>'symbol',r.payload->>'memeToken')) LIKE '%' || $10 || '%')
         AND ($11::numeric IS NULL OR (r.payload->'identity'->>'deployedAt')::numeric >= $11)
         AND ($12::numeric IS NULL OR (r.payload->'identity'->>'deployedAt')::numeric <= $12)
     ) SELECT identity,payload,order_value::text AS order_text FROM candidates WHERE true ${afterClause}
       ORDER BY order_value ${sort.direction} NULLS LAST,identity ASC LIMIT $15`,
    parameters,
  );
  const visible = records.rows.slice(0, limit);
  const last = visible.at(-1);
  const nextCursor = records.rows.length > limit && last ? encodeCursor({
    scope: 'markets', revision: publication.revision, filterDigest,
    sortKey: last.order_text === null ? 'n:' : `v:${last.order_text}`, identity: last.identity,
  }, input.secret) : null;
  return { items: visible.map((row) => row.payload), nextCursor, sync: await syncForPublication(input.pool, schema, input.deployment, publication) };
}

export async function readPublishedRecord(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly scope: string; readonly identity: string;
  readonly includeRecent?: boolean; readonly revision?: string; readonly schemaName?: string;
}): Promise<{ item: Json | null; sync: SyncStatus }> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const publication = await resolvePublication(input.pool, schema, input.deployment, input.scope, input.revision);
  const record = await input.pool.query<{ payload: Json }>(
    `SELECT r.payload FROM ${schema}.projection_records r
     JOIN ${schema}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=$5
     WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope=$4 AND r.revision=$6 AND r.identity=$7
       AND b.canonical AND b.finalized`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope,
      publication.blockHash, publication.revision, input.identity],
  );
  let item=record.rows[0]?.payload??null;
  if(!item&&input.includeRecent&&input.scope==='markets'){
    const recent=await input.pool.query<{payload:Json}>(`SELECT payload FROM ${schema}.recent_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND canonical AND expires_at>now() AND block_number>$5`,[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,input.identity,publication.blockNumber.toString()]);
    item=recent.rows[0]?.payload??null;
  }
  return { item, sync: await syncForPublication(input.pool, schema, input.deployment, publication) };
}

export async function readPublishedUserPage(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly kind: 'accounts' | 'positions'; readonly user: `0x${string}`;
  readonly secret: string; readonly revision?: string; readonly cursor?: string; readonly limit?: number; readonly schemaName?: string;
}): Promise<{ items: Json[]; nextCursor: string | null; sync: SyncStatus }> {
  if (!/^0x[0-9a-f]{40}$/.test(input.user)) throw new Error('invalid user address');
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const publication = await resolvePublication(input.pool, schema, input.deployment, input.kind, input.revision);
  const filterDigest = digest({ user: input.user });
  const after = input.cursor ? decodeCursor(input.cursor, { scope: input.kind, revision: publication.revision, filterDigest }, input.secret) : undefined;
  const records = await input.pool.query<{ identity: string; sort_key: string; payload: Json }>(
    `SELECT r.identity,r.sort_key,r.payload FROM ${schema}.projection_records r
     JOIN ${schema}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=$4
     WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope=$5 AND r.revision=$6
       AND b.canonical AND b.finalized AND r.payload->>'user'=$7
       AND ($8::text IS NULL OR (r.sort_key,r.identity)>($8,$9)) ORDER BY r.sort_key,r.identity LIMIT $10`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, publication.blockHash,
      input.kind, publication.revision, input.user, after?.sortKey ?? null, after?.identity ?? null, limit + 1],
  );
  const visible = records.rows.slice(0, limit); const last = visible.at(-1);
  const nextCursor = records.rows.length > limit && last ? encodeCursor({ scope: input.kind, revision: publication.revision,
    filterDigest, sortKey: last.sort_key, identity: last.identity }, input.secret) : null;
  return { items: visible.map((row) => row.payload), nextCursor, sync: await syncForPublication(input.pool, schema, input.deployment, publication) };
}

export async function readCreatorMarkets(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly address: `0x${string}`; readonly secret: string;
  readonly cursor?: string; readonly limit?: number; readonly schemaName?: string;
}): Promise<{ chainId: number; address: string; displayOnly: true; complete: true; items: Json[]; nextCursor: string | null }> {
  if (!/^0x[0-9a-f]{40}$/.test(input.address)) throw new Error('invalid address');
  const limit = input.limit ?? 100; if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid limit');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); const checkpoint = await resolveHistoryCheckpoint(input.pool, schema, input.deployment);
  const filterDigest = digest({ address: input.address });
  const after = input.cursor ? decodeCursor(input.cursor, { scope: 'creator-markets', revision: checkpoint.revision, filterDigest }, input.secret) : undefined;
  const rows = await input.pool.query<{ identity: string; payload: Json }>(`SELECT identity,payload FROM ${schema}.aggregate_records
    WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='creator-market' AND complete AND payload->>'creator'=$4
      AND ($5::text IS NULL OR identity>$5) ORDER BY identity LIMIT $6`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.address, after?.identity ?? null, limit + 1]);
  const visible = rows.rows.slice(0, limit); const last = visible.at(-1);
  const nextCursor = rows.rows.length > limit && last ? encodeCursor({ scope: 'creator-markets', revision: checkpoint.revision,
    filterDigest, sortKey: last.identity, identity: last.identity }, input.secret) : null;
  return { chainId: input.deployment.chainId, address: input.address, displayOnly: true, complete: true, items: visible.map((row) => row.payload), nextCursor };
}

export async function readHolderMarkets(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly query: string; readonly schemaName?: string }): Promise<{
  chainId: number; complete: true; items: Json[] }> {
  const query = input.query.trim().toLocaleLowerCase(); if (query.length > 200) throw new Error('invalid query');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); await resolveHistoryCheckpoint(input.pool, schema, input.deployment);
  const rows = await input.pool.query<{ payload: Json }>(`SELECT payload FROM ${schema}.aggregate_records
    WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='holder-market' AND complete
      AND ($4='' OR lower(concat_ws(' ',payload->>'marketId',payload->>'memeToken',payload->>'name',payload->>'symbol')) LIKE '%' || $4 || '%')
    ORDER BY lower(payload->>'symbol'),identity LIMIT 20`, [...deploymentIdentity(input.deployment), query]);
  return { chainId: input.deployment.chainId, complete: true, items: rows.rows.map((row) => row.payload) };
}

export async function readWalletHolderMarkets(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly account: `0x${string}`; readonly schemaName?: string }): Promise<{
  chainId: number; account: string; displayOnly: true; complete: true; items: Json[] }> {
  if (!/^0x[0-9a-f]{40}$/.test(input.account)) throw new Error('invalid account');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); await resolveHistoryCheckpoint(input.pool, schema, input.deployment);
  const rows = await input.pool.query<{ payload: Json }>(`SELECT payload-'account' AS payload FROM ${schema}.aggregate_records
    WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='wallet-holder-market' AND complete AND payload->>'account'=$4
    ORDER BY identity LIMIT 10000`, [...deploymentIdentity(input.deployment), input.account]);
  return { chainId: input.deployment.chainId, account: input.account, displayOnly: true, complete: true, items: rows.rows.map((row) => row.payload) };
}

export async function readRewardHistory(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly kind: 'holder' | 'staker';
  readonly marketId: `0x${string}`; readonly account: `0x${string}`; readonly throughBlock: bigint; readonly schemaName?: string }): Promise<{
  chainId: number; displayOnly: true; marketId: string; account: string; throughBlock: string; complete: boolean; claimed: Record<string, string> }> {
  if (!/^0x[0-9a-f]{64}$/.test(input.marketId) || !/^0x[0-9a-f]{40}$/.test(input.account) || input.throughBlock < input.deployment.activationBlock) throw new Error('invalid reward history query');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); const checkpoint = await resolveHistoryCheckpoint(input.pool, schema, input.deployment);
  const complete = checkpoint.blockNumber >= input.throughBlock; const claimed: Record<string, string> = {};
  if (complete) {
    const rows = await input.pool.query<{ asset: string; amount: string }>(`SELECT asset,sum(amount_raw)::text AS amount FROM ${schema}.reward_history
      WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND kind=$4 AND market_id=$5 AND account=$6 AND through_block<=$7 GROUP BY asset ORDER BY asset`,
      [...deploymentIdentity(input.deployment), input.kind, input.marketId, input.account, input.throughBlock.toString()]);
    for (const row of rows.rows) claimed[row.asset] = row.amount;
  }
  return { chainId: input.deployment.chainId, displayOnly: true, marketId: input.marketId, account: input.account,
    throughBlock: input.throughBlock.toString(), complete, claimed };
}

export async function readLaunchRecovery(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly marketId: `0x${string}`; readonly schemaName?: string }): Promise<{
  chainId: number; displayOnly: true; marketId: string; transactionHash: string; blockNumber: string; blockHash: string; finality: 'finalized';
}> {
  if (!/^0x[0-9a-f]{64}$/.test(input.marketId)) throw new Error('invalid market id');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); await resolveHistoryCheckpoint(input.pool, schema, input.deployment);
  const row = (await input.pool.query<{ payload: Json }>(`SELECT payload FROM ${schema}.aggregate_records
    WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='launch-recovery' AND identity=$4 AND complete`,
    [...deploymentIdentity(input.deployment), input.marketId])).rows[0];
  if (!row) throw new PublicationUnavailableError('launch recovery is not indexed');
  const value = row.payload as Record<string, Json>;
  if (value.chainId !== input.deployment.chainId || value.displayOnly !== true || value.marketId !== input.marketId
    || typeof value.transactionHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(value.transactionHash)
    || typeof value.blockNumber !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value.blockNumber)
    || typeof value.blockHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(value.blockHash) || value.finality !== 'finalized') {
    throw new PublicationUnavailableError('launch recovery record is invalid');
  }
  return value as { chainId: number; displayOnly: true; marketId: string; transactionHash: string; blockNumber: string; blockHash: string; finality: 'finalized' };
}

export async function readUserActivity(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly account: `0x${string}`;
  readonly secret: string; readonly cursor?: string; readonly limit?: number; readonly schemaName?: string }): Promise<{
  chainId: number; account: string; items: Json[]; nextCursor: string | null; indexedFrom: string; sourceBlockNumber: string; sourceBlockHash: string;
  revision: string; finality: 'finalized'; observedAt: string; displayOnly: true }> {
  if (!/^0x[0-9a-f]{40}$/.test(input.account) || /^0x0{40}$/.test(input.account)) throw new Error('invalid account');
  const limit = input.limit ?? 50; if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid limit');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); const checkpoint = await resolveHistoryCheckpoint(input.pool, schema, input.deployment);
  const revision = `sha256:${createHash('sha256').update(`f72-activity-v1:${checkpoint.revision}`).digest('hex')}`;
  const filterDigest = digest({ account: input.account });
  const after = input.cursor ? decodeCursor(input.cursor, { scope: 'activity', revision, filterDigest }, input.secret) : undefined;
  const position = after ? parseActivityPosition(after.sortKey) : null;
  const rows = await input.pool.query<{ payload: Record<string, Json> }>(`SELECT payload FROM ${schema}.user_activity
    WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND account=$4
      AND ($5::numeric IS NULL OR ((payload->>'blockNumber')::numeric,(payload->>'transactionIndex')::numeric,(payload->>'logIndex')::numeric)<($5,$6,$7))
    ORDER BY (payload->>'blockNumber')::numeric DESC,(payload->>'transactionIndex')::numeric DESC,(payload->>'logIndex')::numeric DESC LIMIT $8`,
    [...deploymentIdentity(input.deployment), input.account, position?.[0] ?? null, position?.[1] ?? null, position?.[2] ?? null, limit + 1]);
  const visible = rows.rows.slice(0, limit); const last = visible.at(-1)?.payload;
  const items = visible.map(({ payload }) => ({ ...payload, id: `${input.deployment.chainId}:${payload.blockHash}:${payload.transactionHash}:${payload.logIndex}:${input.account}`,
    chainId: input.deployment.chainId, identityBasis: 'event_address_reference_not_verified_initiator' as const }));
  const nextCursor = rows.rows.length > limit && last ? encodeCursor({ scope: 'activity', revision, filterDigest,
    sortKey: `${last.blockNumber}:${last.transactionIndex}:${last.logIndex}`, identity: String(items.at(-1)?.id ?? '') }, input.secret) : null;
  return { chainId: input.deployment.chainId, account: input.account, items, nextCursor, indexedFrom: input.deployment.activationBlock.toString(),
    sourceBlockNumber: checkpoint.blockNumber.toString(), sourceBlockHash: checkpoint.blockHash, revision, finality: 'finalized',
    observedAt: checkpoint.observedAt.toISOString(), displayOnly: true };
}

export async function readSnapshotUpdates(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly since?: string; readonly schemaName?: string }) {
  if (input.since && !/^(0|[1-9][0-9]*):0x[0-9a-f]{64}$/.test(input.since)) throw new Error('invalid since revision');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless'); const scopes = ['markets', 'configs', 'positions', 'accounts'] as const;
  const rows = await input.pool.query<{ scope: string; revision: string; payload_digest: string }>(`SELECT pointer.scope,pointer.revision,p.payload_digest
    FROM ${schema}.publication_pointers pointer JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
    JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash
    WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND pointer.scope=ANY($4::text[]) AND b.canonical AND b.finalized`,
    [...deploymentIdentity(input.deployment), scopes]);
  if (rows.rows.length !== scopes.length || new Set(rows.rows.map((row) => row.revision)).size !== 1) throw new PublicationUnavailableError('coherent snapshot publication is unavailable');
  const revision = rows.rows[0]!.revision; const sync = await readPublishedSync({ pool: input.pool, deployment: input.deployment, scope: 'markets',
    ...(input.schemaName ? { schemaName: input.schemaName } : {}) });
  if (sync.status !== 'synced' || sync.finality !== 'finalized' || sync.revision !== revision) throw new PublicationUnavailableError('snapshot publication is not synchronized');
  if (!input.since) return { mode: 'reset' as const, sync, invalidated: [...scopes], pollAfterMs: 5000 as const };
  if (input.since === revision) return { mode: 'unchanged' as const, sync, invalidated: [] as string[], pollAfterMs: 5000 as const };
  const prior = await input.pool.query<{ scope: string; payload_digest: string }>(`SELECT scope,payload_digest FROM ${schema}.publications
    WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND revision=$4 AND scope=ANY($5::text[])`,
    [...deploymentIdentity(input.deployment), input.since, scopes]);
  if (prior.rows.length !== scopes.length) return { mode: 'reset' as const, sync, invalidated: [...scopes], pollAfterMs: 5000 as const };
  const before = new Map(prior.rows.map((row) => [row.scope, row.payload_digest])); const now = new Map(rows.rows.map((row) => [row.scope, row.payload_digest]));
  return { mode: 'changed' as const, sync, invalidated: scopes.filter((scope) => before.get(scope) !== now.get(scope)), pollAfterMs: 5000 as const };
}

async function resolveHistoryCheckpoint(pool: Pool, schema: string, deployment: DeploymentIdentity): Promise<{ revision: string; blockNumber: bigint; blockHash: string; observedAt: Date }> {
  const result = await pool.query<{ last_revision: string; block_number: string; block_hash: string; observed_at: Date }>(`SELECT c.last_revision,b.number AS block_number,b.hash AS block_hash,b.observed_at
    FROM ${schema}.projection_checkpoints c JOIN ${schema}.chain_blocks b ON b.environment=c.environment AND b.chain_id=c.chain_id
      AND b.deployment_digest=c.deployment_digest AND c.last_revision=(b.number::text || ':' || b.hash)
    WHERE c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3 AND c.scope='history' AND b.canonical AND b.finalized`, deploymentIdentity(deployment));
  const row = result.rows[0]; if (!row?.last_revision) throw new PublicationUnavailableError('history projection is unavailable');
  return { revision: row.last_revision, blockNumber: BigInt(row.block_number), blockHash: row.block_hash, observedAt: row.observed_at };
}
function parseActivityPosition(value: string): [string, string, string] { const parts = value.split(':');
  if (parts.length !== 3 || parts.some((item) => !/^(0|[1-9][0-9]*)$/.test(item))) throw new PublicationChangedError('activity cursor position is invalid');
  return [parts[0]!, parts[1]!, parts[2]!]; }
function deploymentIdentity(deployment: DeploymentIdentity): [string, number, string] { return [deployment.environment, deployment.chainId, deployment.deploymentDigest] }

export async function readPublishedConfigPage(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly kind: 'asset' | 'quote' | 'baseline' | 'template';
  readonly secret: string; readonly revision?: string; readonly cursor?: string; readonly limit?: number; readonly schemaName?: string;
}): Promise<{ items: Json[]; nextCursor: string | null; sync: SyncStatus }> {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const publication = await resolvePublication(input.pool, schema, input.deployment, 'configs', input.revision);
  const filterDigest = digest({ kind: input.kind });
  const after = input.cursor ? decodeCursor(input.cursor, { scope: 'configs', revision: publication.revision, filterDigest }, input.secret) : undefined;
  const records = await input.pool.query<{ identity: string; sort_key: string; payload: Json }>(
    `SELECT r.identity,r.sort_key,r.payload FROM ${schema}.projection_records r
     JOIN ${schema}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=$4
     WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='configs' AND r.revision=$5
       AND b.canonical AND b.finalized AND r.payload->>'kind'=$6
       AND ($7::text IS NULL OR (r.sort_key,r.identity)>($7,$8)) ORDER BY r.sort_key,r.identity LIMIT $9`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, publication.blockHash,
      publication.revision, input.kind, after?.sortKey ?? null, after?.identity ?? null, limit + 1],
  );
  const visible = records.rows.slice(0, limit);
  const last = visible.at(-1);
  const nextCursor = records.rows.length > limit && last ? encodeCursor({ scope: 'configs', revision: publication.revision,
    filterDigest, sortKey: last.sort_key, identity: last.identity }, input.secret) : null;
  return { items: visible.map((row) => row.payload), nextCursor, sync: await syncForPublication(input.pool, schema, input.deployment, publication) };
}

export async function unavailableSync(deployment: DeploymentIdentity): Promise<SyncStatus> {
  return { chainId: deployment.chainId, status: 'unavailable', blockNumber: null, blockHash: null, finality: 'unavailable', headBlockNumber: null, headBlockHash: null, lagBlocks: null, revision: 'unavailable' };
}

export async function readPublishedSync(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly scope: string; readonly revision?: string; readonly schemaName?: string;
}): Promise<SyncStatus> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const publication = await resolvePublication(input.pool, schema, input.deployment, input.scope, input.revision);
  return syncForPublication(input.pool, schema, input.deployment, publication);
}

async function resolvePublication(pool: Pool, schema: string, deployment: DeploymentIdentity, scope: string, requested?: string): Promise<{ revision: string; blockNumber: bigint; blockHash: `0x${string}` }> {
  if (requested && !/^[0-9]+:0x[0-9a-f]{64}$/.test(requested)) throw new PublicationChangedError('requested revision is invalid');
  const result = await pool.query<{ revision: string; block_number: string; block_hash: `0x${string}` }>(
    requested
      ? `SELECT p.revision,p.block_number,p.block_hash FROM ${schema}.publications p JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3 AND p.scope=$4 AND p.revision=$5 AND b.canonical AND b.finalized`
      : `SELECT p.revision,p.block_number,p.block_hash FROM ${schema}.publication_pointers pointer JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision) JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND pointer.scope=$4 AND b.canonical AND b.finalized`,
    requested ? [deployment.environment, deployment.chainId, deployment.deploymentDigest, scope, requested] : [deployment.environment, deployment.chainId, deployment.deploymentDigest, scope],
  );
  const row = result.rows[0];
  if (!row) throw requested ? new PublicationChangedError('requested publication is unavailable') : new PublicationUnavailableError('publication is unavailable');
  return { revision: row.revision, blockNumber: BigInt(row.block_number), blockHash: row.block_hash };
}

async function isPublicationCanonical(pool: Pool, schema: string, deployment: DeploymentIdentity, scope: string, revision: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM ${schema}.publications p JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash
     WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3 AND p.scope=$4 AND p.revision=$5 AND b.canonical AND b.finalized`,
    [deployment.environment, deployment.chainId, deployment.deploymentDigest, scope, revision],
  );
  return Boolean(result.rowCount);
}

async function syncForPublication(pool: Pool, schema: string, deployment: DeploymentIdentity, publication: { revision: string; blockNumber: bigint; blockHash: `0x${string}` }): Promise<SyncStatus> {
  const head = await pool.query<{ number: string; hash: `0x${string}` }>(
    `SELECT number,hash FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND canonical ORDER BY number DESC LIMIT 1`,
    [deployment.environment, deployment.chainId, deployment.deploymentDigest],
  );
  const row = head.rows[0];
  const headNumber = row ? BigInt(row.number) : publication.blockNumber;
  const lag = headNumber >= publication.blockNumber ? headNumber - publication.blockNumber : 0n;
  return {
    chainId: deployment.chainId, status: lag === 0n ? 'synced' : 'lagging', blockNumber: publication.blockNumber.toString(), blockHash: publication.blockHash,
    finality: 'finalized', headBlockNumber: headNumber.toString(), headBlockHash: row?.hash ?? publication.blockHash, lagBlocks: lag.toString(), revision: publication.revision,
  };
}

function assertCursorSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32) throw new Error('cursor secret must contain at least 32 bytes');
}

function digest(value: Json): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name');
  return `"${value}"`;
}

function validateMarketFilter(filter: MarketPageFilter): void {
  const hash = /^0x[0-9a-f]{64}$/;
  const address = /^0x[0-9a-f]{40}$/;
  if ((filter.assetUid && !hash.test(filter.assetUid)) || (filter.marketId && !hash.test(filter.marketId))
    || (filter.memeToken && !address.test(filter.memeToken)) || (filter.launchPhase !== undefined && filter.launchPhase !== 0 && filter.launchPhase !== 1)) throw new Error('invalid market filter');
  if (filter.search !== undefined && (filter.search.length < 1 || filter.search.length > 120 || /[%_\u0000-\u001f]/.test(filter.search))) throw new Error('invalid market search');
  for (const value of [filter.createdFrom, filter.createdTo]) if (value !== undefined && !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('invalid creation time');
  if (filter.createdFrom && filter.createdTo && BigInt(filter.createdFrom) > BigInt(filter.createdTo)) throw new Error('invalid creation time range');
  marketSort(filter.sort ?? 'marketId_asc');
}

function marketFilterJson(filter: MarketPageFilter): Json {
  return { assetUid: filter.assetUid ?? null, marketId: filter.marketId ?? null, memeToken: filter.memeToken ?? null,
    launchPhase: filter.launchPhase ?? null, search: filter.search?.toLocaleLowerCase() ?? null,
    createdFrom: filter.createdFrom ?? null, createdTo: filter.createdTo ?? null, sort: filter.sort ?? 'marketId_asc' };
}

function marketSort(value: NonNullable<MarketPageFilter['sort']>): { expression: string; cast: 'text' | 'numeric' | 'integer'; direction: 'ASC' | 'DESC' } {
  switch (value) {
    case 'marketId_asc': return { expression: `r.payload->>'marketId'`, cast: 'text', direction: 'ASC' };
    case 'marketId_desc': return { expression: `r.payload->>'marketId'`, cast: 'text', direction: 'DESC' };
    case 'createdAt_asc': return { expression: `(r.payload->'identity'->>'deployedAt')::numeric`, cast: 'numeric', direction: 'ASC' };
    case 'createdAt_desc': return { expression: `(r.payload->'identity'->>'deployedAt')::numeric`, cast: 'numeric', direction: 'DESC' };
    case 'name_asc': return { expression: `lower(r.payload->'identity'->>'name')`, cast: 'text', direction: 'ASC' };
    case 'launchPhase_asc': return { expression: `(r.payload->>'launchPhase')::integer`, cast: 'integer', direction: 'ASC' };
    case 'volume24hUsd_desc': return { expression: `(r.payload->'metrics'->>'volume24hUsd')::numeric`, cast: 'numeric', direction: 'DESC' };
    case 'marketCapUsd_desc': return { expression: `(r.payload->'metrics'->>'marketCapUsd')::numeric`, cast: 'numeric', direction: 'DESC' };
    case 'recentBuy_desc': return { expression: `(r.payload->'lastBuy'->>'blockNumber')::numeric`, cast: 'numeric', direction: 'DESC' };
    default: throw new Error('invalid market sort');
  }
}

// Version only concerns immediately observed launches, not finalized accounting.
export async function readRecentMarketVersion(input:{pool:Pool;deployment:DeploymentIdentity;schemaName?:string}):Promise<string>{
 const schema=identifier(input.schemaName??'tickergarden_serverless');
 const result=await input.pool.query<{version:string}>(`SELECT md5(coalesce(string_agg(r.market_id||r.block_hash,',' ORDER BY r.market_id),'')) AS version
 FROM ${schema}.recent_markets r WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.canonical AND r.expires_at>now()
 AND r.block_number>coalesce((SELECT p.block_number FROM ${schema}.publication_pointers pointer JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
 WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND pointer.scope='markets'),-1)`,[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest]);
 return result.rows[0]!.version;
}

/** DB-only settlement-burn totals. Missing publication is unavailable, never a fabricated zero. */
export async function readMemeFeeBurns(input: {readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly marketId:`0x${string}`;readonly schemaName?:string}) {
  if(!/^0x[0-9a-f]{64}$/.test(input.marketId))throw new Error('invalid market id');
  const schema=identifier(input.schemaName??'tickergarden_serverless');
  const checkpoint=await resolveHistoryCheckpoint(input.pool,schema,input.deployment);
  const rows=await input.pool.query<{payload:Json;block_hash:string}>(`SELECT payload,block_hash FROM ${schema}.aggregate_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='meme-fee-burn' AND identity=$4 AND complete`,[...deploymentIdentity(input.deployment),input.marketId]);
  const row=rows.rows[0];
  if(!row||checkpoint.revision!==`${checkpoint.blockNumber}:${row.block_hash}`)throw new PublicationUnavailableError('Meme fee burn history is unavailable');
  return {chainId:input.deployment.chainId,displayOnly:true,finality:'finalized',revision:checkpoint.revision,throughBlock:String(checkpoint.blockNumber),burns:row.payload};
}
