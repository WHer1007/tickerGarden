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

test('market delta depth is bounded and full checkpoints reset the lineage', { timeout: 60_000 }, async (context) => {
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
    await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) SELECT 'test',46630,$1,n,'0x'||lpad(to_hex(n+1000),64,'0'),CASE WHEN n=5 THEN $2 ELSE '0x'||lpad(to_hex(n+999),64,'0') END,true,true FROM generate_series(5,260) n`,[deployment.deploymentDigest,hash('d')]);
    const blockHash=(n:number):`0x${string}`=>n<=4?[hash('0'),hash('a'),hash('b'),hash('c'),hash('d')][n]!:('0x'+BigInt(n+1000).toString(16).padStart(64,'0')) as `0x${string}`;
    await handle.pool.query(`UPDATE ${schema}.covered_ranges SET to_block=260`);
    await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=261,last_block_hash=$1`,[blockHash(260)]);
    let previous=first.revision;
    for(let n=2;n<=257;n++){
      const result=await publishMarketDelta({...base,blockNumber:BigInt(n),blockHash:blockHash(n),baseRevision:previous,records:[],expectedPopulation:3});previous=result.revision;
    }
    await assert.rejects(publishMarketDelta({...base,blockNumber:258n,blockHash:blockHash(258),baseRevision:previous,records:[],expectedPopulation:3}),/checkpoint|depth/);
    const checkpoint=await publishProjection({...base,blockNumber:258n,blockHash:blockHash(258),records:initial});
    const last=await publishMarketDelta({...base,blockNumber:259n,blockHash:blockHash(259),baseRevision:checkpoint.revision,records:[],expectedPopulation:3});
    assert.deepEqual(await auditMarketPublication({pool:handle.pool,deployment,revision:last.revision,schemaName}),{revision:last.revision,records:3,fullCheckpoint:checkpoint.revision,deltas:1,verified:true});
  }finally{await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>undefined);await handle.pool.end();}
});
