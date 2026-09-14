import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { auditMarketPublication } from '../../packages/projection/src/audit.ts';
import { publishMarketDelta, publishProjection } from '../../packages/projection/src/index.ts';
import { readPublishedRecord } from '../../packages/read-store/src/index.ts';

const connectionString = process.env.TG_TEST_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (c: string): `0x${string}` => `0x${c.repeat(64)}`;
const ident = (v: string): string => { assert.match(v, /^[a-z][a-z0-9_]{0,62}$/); return `"${v}"`; };

test('market delta publishes an atomic, population checked temporal revision', { timeout: 30_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_TEST_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_delta_${process.pid}_${randomBytes(4).toString('hex')}`;
  const schema = ident(schemaName);
  const handle = createDatabasePool(connectionString, { max: 2 });
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: hash('1'), activationBlock: 1n };
  const ids = [hash('2'), hash('3'), hash('4')];
  const record = (id: string, name: string) => ({ identity: id, sortKey: id, payload: { marketId: id, assetUid: hash('5'), memeToken: `0x${'1'.repeat(40)}`, quoteAsset: `0x${'2'.repeat(40)}`, launchPhase: 0, identity: { name, symbol: name, deployedAt: '1' } } });
  const initial = ids.map((id, i) => record(id, `Market ${i}`));
  try {
    await applyCoreMigration(handle.pool, schemaName);
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES ('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest, hash('6'), hash('0'), hash('7')]);
    for (const [number, blockHash, parentHash] of [[1, hash('a'), hash('0')], [2, hash('b'), hash('a')], [3, hash('c'), hash('b')], [4, hash('d'), hash('c')]] as const) await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES ('test',46630,$1,$2,$3,$4,true,true)`, [deployment.deploymentDigest, number, blockHash, parentHash]);
    await handle.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES ('test',46630,$1,'frontend-events',2,$2,0)`, [deployment.deploymentDigest, hash('a')]);
    await handle.pool.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES ('test',46630,$1,1,1,0,$2,true,now())`, [deployment.deploymentDigest, hash('8')]);
    const base = { pool: handle.pool, deployment, scope: 'markets', algorithmVersion: 'delta-v1', generation: 0n, incrementalMarketVersions: true, schemaName } as const;
    const first = await publishProjection({ ...base, blockNumber: 1n, blockHash: hash('a'), records: initial });
    assert.equal(first.records, 3);
    await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=3,last_block_hash=$1 WHERE stream='frontend-events'`, [hash('b')]);
    await handle.pool.query(`UPDATE ${schema}.covered_ranges SET to_block=2 WHERE generation=0`);
    const added = record(hash('6'), 'Market 3');
    const changed = record(ids[1]!, 'Market changed');
    const delta = { ...base, blockNumber: 2n, blockHash: hash('b'), baseRevision: first.revision, records: [changed, added], removed: [ids[2]!], expectedPopulation: 3 } as const;
    assert.deepEqual(await publishMarketDelta(delta), { revision: `2:${hash('b')}`, duplicate: false, records: 3 });
    const nameOf = (item: unknown): string | undefined => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
      const identity = (item as { identity?: unknown }).identity;
      return identity && typeof identity === 'object' && !Array.isArray(identity) ? (identity as { name?: unknown }).name as string | undefined : undefined;
    };
    assert.equal(nameOf((await readPublishedRecord({ pool: handle.pool, deployment, scope: 'markets', identity: ids[0]!, revision: first.revision, schemaName })).item), 'Market 0');
    assert.equal(nameOf((await readPublishedRecord({ pool: handle.pool, deployment, scope: 'markets', identity: ids[1]!, revision: `2:${hash('b')}`, schemaName })).item), 'Market changed');
    assert.equal((await readPublishedRecord({ pool: handle.pool, deployment, scope: 'markets', identity: ids[2]!, revision: `2:${hash('b')}`, schemaName })).item, null);
    assert.deepEqual(await publishMarketDelta(delta), { revision: `2:${hash('b')}`, duplicate: true, records: 3 });
    assert.deepEqual(await auditMarketPublication({ pool: handle.pool, deployment, revision: `2:${hash('b')}`, schemaName }), { revision: `2:${hash('b')}`, records: 3, fullCheckpoint: first.revision, deltas: 1, verified: true });
    await assert.rejects(publishMarketDelta({ ...delta, records: [record(ids[1]!, 'conflict'), added] }), /different evidence/);
    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false WHERE number=2`);
    await assert.rejects(publishMarketDelta({ ...delta, blockNumber: 3n, blockHash: hash('c'), baseRevision: delta.blockNumber + ':' + delta.blockHash, records: [], removed: [], expectedPopulation: 3 }), /base is unavailable|checkpoint does not cover/);
    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=true WHERE number=2`);
    await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=4,last_block_hash=$1 WHERE stream='frontend-events'`, [hash('c')]);
    await handle.pool.query(`UPDATE ${schema}.covered_ranges SET to_block=3 WHERE generation=0`);
    await assert.rejects(publishMarketDelta({ ...delta, blockNumber: 3n, blockHash: hash('c'), generation: 1n, baseRevision: delta.blockNumber + ':' + delta.blockHash, records: [], removed: [], expectedPopulation: 3 }), /base is unavailable|checkpoint does not cover/);
    await assert.rejects(publishMarketDelta({ ...delta, blockNumber: 3n, blockHash: hash('c'), baseRevision: first.revision, records: [], removed: [], expectedPopulation: 3 }), /superseded/);
    await assert.rejects(publishMarketDelta({ ...delta, blockNumber: 3n, blockHash: hash('c'), baseRevision: `2:${hash('b')}`, records: [], removed: [], expectedPopulation: 99 }), /population/);
    assert.equal((await handle.pool.query(`SELECT revision FROM ${schema}.publication_pointers WHERE scope='markets'`)).rows[0]?.revision, `2:${hash('b')}`);
    const corrupt = record(hash('9'), 'Undeclared version');
    await handle.pool.query(`INSERT INTO ${schema}.market_record_versions(environment,chain_id,deployment_digest,generation,identity,valid_from,sort_key,payload_digest,payload) VALUES('test',46630,$1,0,$2,2,$2,$3,$4)`, [deployment.deploymentDigest, corrupt.identity, hash('d'), corrupt.payload]);
    await assert.rejects(auditMarketPublication({ pool: handle.pool, deployment, revision: `2:${hash('b')}`, schemaName }), /undeclared market version change/);
  } finally { await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end(); }
});
