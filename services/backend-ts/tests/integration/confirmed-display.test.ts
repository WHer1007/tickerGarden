import {readConfirmedState} from '../../packages/confirmed-display/src/read.ts';
import {changeChannel} from '../../packages/confirmed-display/src/changes.ts';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import type { DeploymentIdentity, RpcBlock, RpcTransport } from '../../packages/chain/src/index.ts';
import { advanceConfirmedDisplay } from '../../packages/confirmed-display/src/worker.ts';
import type { DisplayState } from '../../packages/confirmed-display/src/state.ts';
import type { MarketCreation } from '../../packages/market-projector/src/index.ts';

// The default points only at a local Unix socket. CI/dev can override it explicitly,
// but this test never reads TG_DATABASE_URL or any deployment environment setting.
const databaseUrl = process.env.TG_TEST_DISPLAY_DATABASE_URL ?? 'postgresql:///postgres?host=/tmp';
const parsedDatabaseUrl=new URL(databaseUrl.replace(/@(?=\/)/,'@localhost'));const databaseHost=parsedDatabaseUrl.searchParams.get('host')??parsedDatabaseUrl.hostname;if(!['/tmp','localhost','127.0.0.1','::1'].includes(databaseHost))throw Error('Confirmed display integration tests require local PostgreSQL');
const hash = (n: string): `0x${string}` => `0x${n.repeat(64)}`;
const address = (n: string): `0x${string}` => `0x${n.repeat(40)}`;

function block(number: bigint, hashValue: `0x${string}`, parentHash: `0x${string}`): RpcBlock {
  return { number, hash: hashValue, parentHash, timestamp: 1_800_000_000n + number };
}

function fakeRpc(options: { canonicalOrphan?: boolean; head?: bigint } = {}): RpcTransport {
  const canonical = new Map<bigint, RpcBlock>([
    [10n, block(10n, hash('a'), hash('9'))],
    [11n, block(11n, hash('b'), hash('a'))],
    [12n, block(12n, options.canonicalOrphan ? hash('d') : hash('c'), hash('b'))],
  ]);
  return {
    chainId: async () => 46630n,
    finalizedBlock: async () => block(10n, hash('a'), hash('9')),
    latestBlock: async () => canonical.get(options.head ?? 12n)!,
    block: async (number: bigint) => {
      const value = canonical.get(number);
      if (!value) throw new Error(`unexpected fake block ${number}`);
      return value;
    },
    logs: async () => [],
    call: async (method: string) => {
      if (method === 'eth_getLogs') return [];
      throw new Error(`unexpected fake RPC call ${method}`);
    },
  } as unknown as RpcTransport;
}

function displayState(marketId: string, marker: string): DisplayState {
  return {
    creation: {} as MarketCreation,
    market: { marketId, display: {} } as DisplayState['market'],
    balances: {}, exclusions: [], supply: '0', trades: [], fees: [], historyFrom: 0, asOf: 0,
    blockNumber: '12', blockHash: hash('c'), marker,
  } as DisplayState;
}

test('confirmed display advances an empty range idempotently and rolls back orphan state', { timeout: 60_000 }, async (context) => {
  const schemaName = `tg_display_${process.pid}_${randomBytes(5).toString('hex')}`;
  const schema = `"${schemaName}"`;
  const db = createDatabasePool(databaseUrl, { max: 2, connectionTimeoutMillis: 5_000 });
  const deployment: DeploymentIdentity = {
    environment: 'test', chainId: 46630, deploymentDigest: hash('1'), activationBlock: 10n,
  };
  const id = ['test', 46630, deployment.deploymentDigest] as const;
  try {
    try {
      await applyCoreMigration(db.pool, schemaName);
    } catch (error) {
      if(process.env.TG_TEST_DISPLAY_DATABASE_URL||!['ECONNREFUSED','ENOENT','28P01','28000'].includes(String((error as {code?:string}).code)))throw error;
      context.skip('Local PostgreSQL unavailable for confirmed display integration test');
      return;
    }

    await db.pool.query(
      `INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest)
       VALUES($1,$2,$3,$4,10,$5,$6)`,
      [...id, hash('2'), hash('a'), hash('3')],
    );
    await db.pool.query(
      `INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp)
       VALUES($1,$2,$3,10,$4,$5,true,true,to_timestamp($6))`,
      [...id, hash('a'), hash('9'), Number(1_800_000_010n)],
    );
    await db.pool.query(
      `INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision)
       VALUES($1,$2,$3,'analytics','integration-fixture',11,4,$4)`,
      [...id, `10:${hash('a')}`],
    );

    const rpc = fakeRpc();
    assert.equal(await advanceConfirmedDisplay({ pool: db.pool, deployment, rpc, schemaName }), `confirmed:12:0`);
    assert.equal(await advanceConfirmedDisplay({ pool: db.pool, deployment, rpc, schemaName }), 'current');
    const cursor = (await db.pool.query(`SELECT block_number::text,block_hash FROM ${schema}.confirmed_display_cursor`)).rows[0];
    assert.deepEqual(cursor, { block_number: '12', block_hash: hash('c') });
    const checkpoint = (await db.pool.query(`SELECT next_block::text,generation::text,last_revision FROM ${schema}.projection_checkpoints WHERE scope='analytics'`)).rows[0];
    assert.deepEqual(checkpoint, { next_block: '11', generation: '4', last_revision: `10:${hash('a')}` });

    const existingId = hash('4');
    const orphanOnlyId = hash('5');
    const prior = displayState(existingId, 'before orphan block');
    const orphanOnly = displayState(orphanOnlyId, 'created on orphan block');
    await db.pool.query(
      `INSERT INTO ${schema}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload)
       VALUES($1,$2,$3,$4,11,$5,$6),($1,$2,$3,$7,12,$8,$9)`,
      [...id, existingId, hash('b'), JSON.stringify(prior), orphanOnlyId, hash('c'), JSON.stringify(orphanOnly)],
    );
    const chartOnly=await readConfirmedState(db.pool,deployment,existingId,schemaName,'chart');
    assert.ok(chartOnly?.payload.market);assert.equal(chartOnly?.payload.balances,undefined);assert.equal(chartOnly?.payload.fees,undefined);assert.deepEqual(chartOnly?.payload.trades,[]);
    await db.pool.query(`DELETE FROM ${schema}.confirmed_display_journal WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number=12`, [...id]);
    await db.pool.query(
      `INSERT INTO ${schema}.confirmed_display_journal(environment,chain_id,deployment_digest,block_number,block_hash,previous_number,previous_hash,previous_timestamp,undo)
       VALUES($1,$2,$3,12,$4,11,$5,1800000011,$6)`,
      [...id, hash('c'), hash('b'), JSON.stringify({ [existingId]: prior, [orphanOnlyId]: null })],
    );

    await db.pool.query(`INSERT INTO ${schema}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload) VALUES($1,$2,$3,$4,$5,12,$6,'{}')`,[...id,orphanOnlyId,hash('f'),hash('c')]);
    const notifyDb=createDatabasePool(databaseUrl,{max:1});const listener=await notifyDb.pool.connect();
    const notices:Array<{marketId:string;regions:string[]}>=[];
    try{
      listener.on('notification',n=>{if(n.payload)notices.push(JSON.parse(n.payload));});
      await listener.query(`LISTEN ${changeChannel(deployment,schemaName)}`);
      assert.equal(await advanceConfirmedDisplay({ pool: db.pool, deployment, rpc: fakeRpc({ canonicalOrphan: true, head: 11n }), schemaName }), 'current');
      for(let i=0;i<100&&notices.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
      assert.deepEqual(notices.map(n=>n.marketId).sort(),[existingId,orphanOnlyId].sort());
      assert.ok(notices.every(n=>n.regions.includes('chart')&&n.regions.includes('staking')));
    }finally{listener.release(true);await notifyDb.pool.end();}
    assert.equal((await db.pool.query(`SELECT canonical FROM ${schema}.recent_markets WHERE market_id=$1`,[orphanOnlyId])).rows[0]?.canonical,false);
    const restored = await db.pool.query(`SELECT market_id,payload FROM ${schema}.confirmed_display_markets ORDER BY market_id`);
    assert.deepEqual(restored.rows, [{ market_id: existingId, payload: prior }]);
    assert.equal((await db.pool.query(`SELECT count(*)::int count FROM ${schema}.confirmed_display_journal WHERE block_number=12`)).rows[0]?.count, 0);
    const rewound = (await db.pool.query(`SELECT block_number::text,block_hash FROM ${schema}.confirmed_display_cursor`)).rows[0];
    assert.deepEqual(rewound, { block_number: '11', block_hash: hash('b') });
    const checkpointAfterRewind = (await db.pool.query(`SELECT next_block::text,generation::text,last_revision FROM ${schema}.projection_checkpoints WHERE scope='analytics'`)).rows[0];
    assert.deepEqual(checkpointAfterRewind, checkpoint);
  } finally {
    await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await db.pool.end();
  }
});
