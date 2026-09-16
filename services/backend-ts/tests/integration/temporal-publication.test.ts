import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { publishProjection } from '../../packages/projection/src/index.ts';
import { readPublishedMarketPage, readPublishedRecord } from '../../packages/read-store/src/index.ts';

const connectionString = process.env.TG_TEST_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (c: string): `0x${string}` => `0x${c.repeat(64)}`;
const ident = (v: string): string => { assert.match(v, /^[a-z][a-z0-9_]{0,62}$/); return `"${v}"`; };

test('temporal market publications retain revisions and close old versions safely', { timeout: 30_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_TEST_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_temporal_${process.pid}_${randomBytes(4).toString('hex')}`;
  const schema = ident(schemaName);
  const handle = createDatabasePool(connectionString, { max: 2 });
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: hash('1'), activationBlock: 1n };
  const blocks = [[1n, hash('a'), hash('0')], [2n, hash('b'), hash('a')], [3n, hash('c'), hash('b')], [4n, hash('d'), hash('c')], [5n, hash('e'), hash('d')]] as const;
  const ids = [hash('2'), hash('3'), hash('4')];
  const record = (id: string, name: string) => ({ identity: id, sortKey: id, payload: {
    marketId: id, assetUid: hash('5'), memeToken: `0x${'1'.repeat(40)}`, quoteAsset: `0x${'2'.repeat(40)}`,
    launchPhase: 0, identity: { name, symbol: name, deployedAt: '1' },
  } });
  const initial = ids.map((id, i) => record(id, `Market ${i}`));
  const changed = [initial[0]!, record(ids[1]!, 'Market changed'), initial[2]!];
  try {
    await applyCoreMigration(handle.pool, schemaName);
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES ('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest, hash('6'), hash('0'), hash('7')]);
    for (const [number, blockHash, parentHash] of blocks) await handle.pool.query(
      `INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES ('test',46630,$1,$2,$3,$4,true,true)`,
      [deployment.deploymentDigest, number, blockHash, parentHash]);
    await handle.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES ('test',46630,$1,'frontend-events',3,$2,0)`, [deployment.deploymentDigest, hash('b')]);
    await handle.pool.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES ('test',46630,$1,1,4,0,$2,true,now())`, [deployment.deploymentDigest, hash('8')]);

    const base = { pool: handle.pool, deployment, scope: 'markets', algorithmVersion: 'temporal-test-v1', generation: 0n, incrementalMarketVersions: true, schemaName } as const;
    assert.deepEqual(await publishProjection({ ...base, blockNumber: 1n, blockHash: hash('a'), records: initial }), { revision: `1:${hash('a')}`, duplicate: false, records: 3 });
    assert.deepEqual(await publishProjection({ ...base, blockNumber: 2n, blockHash: hash('b'), records: changed }), { revision: `2:${hash('b')}`, duplicate: false, records: 3 });
    const counts = await handle.pool.query(`SELECT (SELECT count(*) FROM ${schema}.market_record_versions) AS versions, (SELECT count(*) FROM ${schema}.projection_read_records WHERE revision=$1) AS first, (SELECT count(*) FROM ${schema}.projection_read_records WHERE revision=$2) AS second`, [`1:${hash('a')}`, `2:${hash('b')}`]);
    assert.deepEqual(counts.rows[0], { versions: '4', first: '3', second: '3' });
    const old = await handle.pool.query(`SELECT payload FROM ${schema}.projection_read_records WHERE revision=$1 AND identity=$2`, [`1:${hash('a')}`, ids[1]]);
    assert.equal((old.rows[0]!.payload as any).identity.name, 'Market 1');
    assert.deepEqual(await publishProjection({ ...base, blockNumber: 2n, blockHash: hash('b'), records: changed }), { revision: `2:${hash('b')}`, duplicate: true, records: 3 });
    await assert.rejects(publishProjection({ ...base, blockNumber: 2n, blockHash: hash('b'), records: [initial[0]!, record(ids[1]!, 'conflict'), initial[2]!] }), /different evidence/);
    await assert.rejects(handle.pool.query(`DELETE FROM ${schema}.market_record_versions`), /market state versions are immutable/);
    await assert.rejects(handle.pool.query(`UPDATE ${schema}.market_record_versions SET payload='{}'`), /only closing a market validity interval is allowed/);
    await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=5,last_block_hash=$1 WHERE stream='frontend-events'`, [hash('d')]);
    const deleted = [initial[0]!, initial[2]!];
    assert.deepEqual(await publishProjection({ ...base, blockNumber: 3n, blockHash: hash('c'), records: deleted }), { revision: `3:${hash('c')}`, duplicate: false, records: 2 });
    assert.equal((await readPublishedRecord({ pool: handle.pool, deployment, scope: 'markets', identity: ids[1]!, revision: `3:${hash('c')}`, schemaName })).item, null);
    assert.deepEqual(await publishProjection({ ...base, blockNumber: 4n, blockHash: hash('d'), records: initial }), { revision: `4:${hash('d')}`, duplicate: false, records: 3 });
    const current = (await readPublishedRecord({ pool: handle.pool, deployment, scope: 'markets', identity: ids[1]!, revision: `4:${hash('d')}`, schemaName })).item;
    assert.ok(current && typeof current === 'object' && !Array.isArray(current) && 'identity' in current);
    assert.equal((current.identity as { name: string }).name, 'Market 1');
    const historic = (await readPublishedRecord({ pool: handle.pool, deployment, scope: 'markets', identity: ids[1]!, revision: `1:${hash('a')}`, schemaName })).item;
    assert.ok(historic && typeof historic === 'object' && !Array.isArray(historic) && 'identity' in historic);
    assert.equal((historic.identity as { name: string }).name, 'Market 1');
    const generationOne = { ...base, generation: 1n, algorithmVersion: 'temporal-test-v2' };
    await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=6,last_block_hash=$1,generation=1 WHERE stream='frontend-events'`, [hash('e')]);
    await handle.pool.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES ('test',46630,$1,1,5,1,$2,true,now())`, [deployment.deploymentDigest, hash('9')]);
    assert.deepEqual(await publishProjection({ ...generationOne, blockNumber: 5n, blockHash: hash('e'), records: initial }), { revision: `5:${hash('e')}`, duplicate: false, records: 3 });
    assert.equal((await handle.pool.query(`SELECT count(*)::int AS n FROM ${schema}.market_record_versions WHERE generation=1`)).rows[0].n, 3);
    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false WHERE number=5`);
    await assert.rejects(readPublishedMarketPage({ pool: handle.pool, deployment, filter: {}, secret: 'x'.repeat(32), schemaName }), /publication is unavailable/);
    await assert.rejects(readPublishedRecord({ pool: handle.pool, deployment, scope: 'markets', identity: ids[1]!, schemaName }), /publication is unavailable/);
  } finally { await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end(); }
});
