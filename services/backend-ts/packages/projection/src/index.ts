import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import { transaction } from '../../db/src/index.ts';

export type Json = null | boolean | string | number | readonly Json[] | { readonly [key: string]: Json };

export interface ProjectionRecord {
  readonly identity: string;
  readonly sortKey: string;
  readonly payload: Json;
}

export interface PublishProjectionInput {
  readonly pool: Pool;
  readonly deployment: DeploymentIdentity;
  readonly scope: string;
  readonly algorithmVersion: string;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly generation: bigint;
  readonly stream?: string;
  readonly records: readonly ProjectionRecord[];
  readonly schemaName?: string;
}

export async function publishProjection(input: PublishProjectionInput): Promise<{ revision: string; duplicate: boolean; records: number }> {
  validateInput(input);
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const revision = `${input.blockNumber}:${input.blockHash}`;
  const normalized = [...input.records].sort((left, right) => left.sortKey.localeCompare(right.sortKey) || left.identity.localeCompare(right.identity));
  const payloadDigest = digest(normalized.map((record) => ({ identity: record.identity, sortKey: record.sortKey, payload: record.payload })));

  return transaction(input.pool, async (client) => {
    await assertPublishableAnchor(client, schema, input);
    const publicationPayload = {
      algorithmVersion: input.algorithmVersion, coverage: { fromBlock: input.deployment.activationBlock.toString(), toBlock: input.blockNumber.toString() },
      recordCount: normalized.length,
    };
    const inserted = await client.query(
      `INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, revision,
        input.blockNumber.toString(), input.blockHash, input.generation.toString(), payloadDigest, publicationPayload],
    );
    const duplicate = inserted.rowCount === 0;
    if (duplicate) {
      const existing = await client.query<{ payload_digest: string; generation: string; payload: unknown }>(
        `SELECT payload_digest,generation,payload FROM ${schema}.publications
         WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=$4 AND revision=$5`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, revision],
      );
      if (existing.rows[0]?.payload_digest !== payloadDigest || BigInt(existing.rows[0]?.generation ?? '-1') !== input.generation
        || stableStringify(existing.rows[0]?.payload) !== stableStringify(publicationPayload)) throw new Error('publication revision already exists with different evidence');
    }

    for (const record of normalized) {
      const recordDigest = digest(record.payload);
      const saved = await client.query(
        `INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, revision,
          record.identity, record.sortKey, recordDigest, record.payload],
      );
      if (!saved.rowCount) {
        const existing = await client.query<{ sort_key: string; payload_digest: string }>(
          `SELECT sort_key,payload_digest FROM ${schema}.projection_records
           WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=$4 AND revision=$5 AND identity=$6`,
          [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, revision, record.identity],
        );
        if (existing.rows[0]?.sort_key !== record.sortKey || existing.rows[0]?.payload_digest !== recordDigest) throw new Error('projection record identity conflict');
      }
    }

    const current = await client.query<{ revision: string; block_number: string }>(
      `SELECT p.revision,p.block_number FROM ${schema}.publication_pointers pointer
       JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
       WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND pointer.scope=$4 FOR UPDATE OF pointer`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope],
    );
    if (current.rows[0] && (BigInt(current.rows[0].block_number) > input.blockNumber
      || (BigInt(current.rows[0].block_number) === input.blockNumber && current.rows[0].revision !== revision))) {
      throw new Error('publication pointer cannot move backwards or across a same-height fork');
    }
    await client.query(
      `INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (environment,chain_id,deployment_digest,scope) DO UPDATE SET revision=excluded.revision,updated_at=now()`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, revision],
    );
    await client.query(
      `INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (environment,chain_id,deployment_digest,scope) DO UPDATE SET
         algorithm_version=excluded.algorithm_version,next_block=excluded.next_block,generation=excluded.generation,last_revision=excluded.last_revision,updated_at=now()`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, input.algorithmVersion,
        (input.blockNumber + 1n).toString(), input.generation.toString(), revision],
    );
    return { revision, duplicate, records: normalized.length };
  });
}

export async function invalidateOrphanedPublications(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly generation: bigint; readonly schemaName?: string;
}): Promise<number> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  return transaction(input.pool, async (client) => {
    const orphaned = await client.query<{ scope: string; revision: string; block_number: string }>(
      `SELECT pointer.scope,pointer.revision,p.block_number FROM ${schema}.publication_pointers pointer
       JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
       LEFT JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash
       WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND (b.hash IS NULL OR NOT b.canonical OR NOT b.finalized)
       FOR UPDATE OF pointer`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest],
    );
    for (const row of orphaned.rows) {
      await client.query(
        `DELETE FROM ${schema}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=$4 AND revision=$5`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, row.scope, row.revision],
      );
      await client.query(
        `INSERT INTO ${schema}.invalidations(environment,chain_id,deployment_digest,scope,identity,revision,reason)
         VALUES ($1,$2,$3,$4,$5,$6,'anchor_orphaned')`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, row.scope, row.scope, row.revision],
      );
      await client.query(
        `UPDATE ${schema}.projection_checkpoints SET next_block=$1,generation=$2,last_revision=NULL,updated_at=now()
         WHERE environment=$3 AND chain_id=$4 AND deployment_digest=$5 AND scope=$6`,
        [input.deployment.activationBlock.toString(), input.generation.toString(), input.deployment.environment,
          input.deployment.chainId, input.deployment.deploymentDigest, row.scope],
      );
    }
    return orphaned.rows.length;
  });
}

async function assertPublishableAnchor(client: PoolClient, schema: string, input: PublishProjectionInput): Promise<void> {
  const anchor = await client.query<{ canonical: boolean; finalized: boolean }>(
    `SELECT canonical,finalized FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND hash=$5`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.blockNumber.toString(), input.blockHash],
  );
  if (!anchor.rows[0]?.canonical || !anchor.rows[0].finalized) throw new Error('publication anchor is not canonical and finalized');
  const checkpoint = await client.query<{ next_block: string; generation: string }>(
    `SELECT next_block,generation FROM ${schema}.ingestion_checkpoints
     WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream=$4 FOR SHARE`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.stream ?? 'frontend-events'],
  );
  if (!checkpoint.rows[0] || BigInt(checkpoint.rows[0].next_block) <= input.blockNumber || BigInt(checkpoint.rows[0].generation) !== input.generation) {
    throw new Error('ingestion checkpoint does not cover publication anchor and generation');
  }
  const ranges = await client.query<{ from_block: string; to_block: string }>(
    `SELECT from_block,to_block FROM ${schema}.covered_ranges
     WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND complete AND to_block>=$5 AND from_block<=$6
     ORDER BY from_block,to_block FOR SHARE`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.generation.toString(),
      input.deployment.activationBlock.toString(), input.blockNumber.toString()],
  );
  let cursor = input.deployment.activationBlock;
  for (const range of ranges.rows) {
    const from = BigInt(range.from_block);
    const to = BigInt(range.to_block);
    if (from > cursor) break;
    if (to >= cursor) cursor = to + 1n;
    if (cursor > input.blockNumber) return;
  }
  throw new Error('publication scope has an incomplete covered range');
}

function validateInput(input: PublishProjectionInput): void {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.scope) || !/^[A-Za-z0-9._:-]{1,160}$/.test(input.algorithmVersion)) throw new Error('projection scope or algorithm version is invalid');
  if (input.records.length > 10_000 || input.blockNumber < input.deployment.activationBlock || input.generation < 0n) throw new Error('projection bounds are invalid');
  const identities = new Set<string>();
  for (const record of input.records) {
    if (!record.identity || record.identity.length > 512 || !record.sortKey || record.sortKey.length > 512 || identities.has(record.identity)) throw new Error('projection record identity is invalid or duplicated');
    identities.add(record.identity);
    if (Buffer.byteLength(stableStringify(record.payload)) > 262_144) throw new Error('projection record payload is too large');
  }
}

function digest(value: unknown): `0x${string}` {
  return `0x${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  throw new Error('value is not canonical JSON');
}

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name');
  return `"${value}"`;
}
