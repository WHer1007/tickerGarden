import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { readPublishedMarketPage, readPublishedRecord, readRecentMarketVersion } from '../../packages/read-store/src/index.ts';

const connectionString = process.env.TG_TEST_DATABASE_URL ?? process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const h = (c: string): `0x${string}` => `0x${c.repeat(64)}`;
const deployment = { environment: 'test' as const, chainId: 4663 as const, deploymentDigest: h('d'), activationBlock: 0n };
const payload = (id: string, name: string) => ({ marketId: id, assetUid: h('1'), memeToken: `0x${'1'.repeat(40)}`, quoteAsset: `0x${'2'.repeat(40)}`, launchPhase: 0, identity: { name, symbol: name, deployedAt: '20' }, metrics: {} });

test('recent market overlay is opt-in, filtered, deduplicated, and versioned', { timeout: 30_000 }, async context => {
  if (!connectionString) { context.skip('TG_TEST_DATABASE_URL (or TG_MIGRATION_DATABASE_URL/TG_DATABASE_URL) is required'); return; }
  const schemaName = `tg_recent_${process.pid}_${randomBytes(4).toString('hex')}`;
  const schema = `"${schemaName}"`;
  const handle = createDatabasePool(connectionString, { max: 1 });
  try {
    await applyCoreMigration(handle.pool, schemaName);
    assert.equal(await applyCoreMigration(handle.pool, schemaName), false, 'migration history makes a second run a no-op');
    const revision = `10:${h('b')}`;
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,0,$5,$6)`, [deployment.environment, deployment.chainId, deployment.deploymentDigest, h('e'), h('f'), h('a')]);
    await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,finalized) VALUES($1,$2,$3,10,$4,$5,true)`, [deployment.environment, deployment.chainId, deployment.deploymentDigest, h('b'), h('c')]);
    await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,10,$5,1,$6,'{}')`, [deployment.environment, deployment.chainId, deployment.deploymentDigest, revision, h('b'), h('c')]);
    await handle.pool.query(`INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES($1,$2,$3,'markets',$4)`, [deployment.environment, deployment.chainId, deployment.deploymentDigest, revision]);
    const ids = [h('1'), h('2'), h('3'), h('4')];
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,$5,$5,$6,$7)`, [deployment.environment, deployment.chainId, deployment.deploymentDigest, revision, ids[0], h('c'), JSON.stringify(payload(ids[0]!, 'Final'))]);
    await handle.pool.query(`INSERT INTO ${schema}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload,canonical,expires_at) VALUES($1,$2,$3,$4,$5,11,$6,$7,true,now()+interval '30 minutes'),($1,$2,$3,$8,$5,11,$6,$9,false,now()+interval '30 minutes'),($1,$2,$3,$10,$5,11,$6,$11,true,now()-interval '1 minute'),($1,$2,$3,$12,$5,9,$6,$13,true,now()+interval '30 minutes')`, [deployment.environment, deployment.chainId, deployment.deploymentDigest, ids[0], h('8'), h('9'), JSON.stringify(payload(ids[0]!, 'RecentWins')), ids[1], JSON.stringify(payload(ids[1]!, 'Noncanonical')), ids[2], JSON.stringify(payload(ids[2]!, 'Expired')), ids[3], JSON.stringify(payload(ids[3]!, 'Covered'))]);
    await handle.pool.query(`INSERT INTO ${schema}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload) VALUES($1,$2,$3,$4,$5,11,$6,$7)`, [deployment.environment, deployment.chainId, deployment.deploymentDigest, h('5'), h('8'), h('9'), JSON.stringify(payload(h('5'), 'RecentOnly'))]);
    const base = await readPublishedMarketPage({ pool: handle.pool, deployment, filter: {}, secret: 'x'.repeat(32), schemaName });
    assert.deepEqual(base.items.map(x => (x as any).identity.name), ['Final']);
    const withRecent = await readPublishedMarketPage({ pool: handle.pool, deployment, filter: {}, includeRecent: true, secret: 'x'.repeat(32), schemaName, limit: 1 });
    assert.equal((withRecent.items[0] as any).identity.name, 'Final');
    assert.ok(withRecent.nextCursor);
    const secondPage = await readPublishedMarketPage({ pool: handle.pool, deployment, filter: {}, includeRecent: true, secret: 'x'.repeat(32), schemaName, limit: 1, cursor: withRecent.nextCursor! });
    assert.equal((secondPage.items[0] as any).identity.name, 'RecentOnly');
    assert.equal((await readPublishedMarketPage({ pool: handle.pool, deployment, filter: { search: 'recentonly' }, includeRecent: true, secret: 'x'.repeat(32), schemaName })).items.length, 1);
    const record = await readPublishedRecord({ pool: handle.pool, deployment, scope: 'markets', identity: ids[1]!, includeRecent: true, schemaName });
    assert.equal(record.item, null);
    const versionBefore = await readRecentMarketVersion({ pool: handle.pool, deployment, schemaName });
    await handle.pool.query(`INSERT INTO ${schema}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload) VALUES($1,$2,$3,$4,$5,12,$6,$7)`, [deployment.environment, deployment.chainId, deployment.deploymentDigest, h('6'), h('7'), h('6'), JSON.stringify(payload(h('6'), 'New'))]);
    assert.notEqual(await readRecentMarketVersion({ pool: handle.pool, deployment, schemaName }), versionBefore);
  } finally { await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end(); }
});
