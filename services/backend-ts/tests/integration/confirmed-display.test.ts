import {refreshDisplayPreparation} from '../../packages/confirmed-display/src/maintenance.ts';
import {readConfirmedDetail,readConfirmedState} from '../../packages/confirmed-display/src/read.ts';
import {changeChannel} from '../../packages/confirmed-display/src/changes.ts';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import type { DeploymentIdentity, RpcBlock, RpcTransport } from '../../packages/chain/src/index.ts';
import { advanceConfirmedDisplay } from '../../packages/confirmed-display/src/worker.ts';
import type { DisplayState } from '../../packages/confirmed-display/src/state.ts';
import type { MarketCreation } from '../../packages/market-projector/src/index.ts';
import {runtimeConfigs} from '../../packages/runtime-deployment/src/index.ts';

// The default points only at a local Unix socket. CI/dev can override it explicitly,
// but this test never reads TG_DATABASE_URL or any deployment environment setting.
const databaseUrl = process.env.TG_TEST_DISPLAY_DATABASE_URL ?? 'postgresql:///postgres?host=/tmp';
const parsedDatabaseUrl=new URL(databaseUrl.replace(/@(?=\/)/,'@localhost'));const databaseHost=parsedDatabaseUrl.searchParams.get('host')??parsedDatabaseUrl.hostname;if(!['/tmp','localhost','127.0.0.1','::1'].includes(databaseHost))throw Error('Confirmed display integration tests require local PostgreSQL');
const hash = (n: string): `0x${string}` => `0x${n.repeat(64)}`;
const address = (n: string): `0x${string}` => `0x${n.repeat(40)}`;

function block(number: bigint, hashValue: `0x${string}`, parentHash: `0x${string}`): RpcBlock {
  return { number, hash: hashValue, parentHash, timestamp: 1_800_000_000n + number };
}

function fakeRpc(options: { canonicalOrphan?: boolean; head?: bigint; calls?: string[] } = {}): RpcTransport {
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
      options.calls?.push(method);
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
      listener.on('notification',n=>{if(n.payload){const data=JSON.parse(n.payload);if(data.marketId)notices.push(data);}});
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

test('quiet markets skipped by the prior display cursor are seeded and retain DB-backed detail without trades', {timeout: 60_000}, async context => {
  const schemaName=`tg_display_quiet_${process.pid}_${randomBytes(5).toString('hex')}`,schema=`"${schemaName}"`;
  const db=createDatabasePool(databaseUrl,{max:2,connectionTimeoutMillis:5_000});
  const deployment:DeploymentIdentity={environment:'test',chainId:46630,deploymentDigest:hash('6'),activationBlock:9n},id=['test',46630,deployment.deploymentDigest] as const;
  const marketId=hash('7'),token=address('2'),curve=address('3'),gauge=address('0'),quoteAsset=address('0');
  const baseline=runtimeConfigs.find(c=>c.kind==='baseline')!,quote=runtimeConfigs.find(c=>c.kind==='quote'&&c.values.quoteAsset===quoteAsset)!;
  const totalSupplyRaw=String(baseline.values.supply),timestamp=1_800_000_010;
  const creation:MarketCreation={marketId,assetUid:hash('8'),memeToken:token,curve,gauge,quoteAsset,quoteAssetConfigId:quote.id as `0x${string}`,tickerGardenBaselineId:baseline.id as `0x${string}`,expectedEconomics:hash('9'),source:{chainId:46630,blockNumber:'9',blockHash:hash('9'),transactionHash:hash('f'),transactionIndex:0,logIndex:0}};
  const market={marketId,assetUid:creation.assetUid,memeToken:token,curve,gauge,quoteAsset,quoteAssetConfigId:creation.quoteAssetConfigId,tickerGardenBaselineId:creation.tickerGardenBaselineId,sourceVersion:1,launchPhase:0,creator:address('5'),creatorFeesToHolders:false,stakingEnabled:false,burnMemeFees:false,lpFeePips:0,curveProgress:{realQuoteReserve:'0',sellableTokens:'0',reservedTokens:'0',accruedCurveFees:'0',readyToGraduate:false},poolId:null,poolKey:null,canonicalRoute:{router:address('0'),quoter:address('0'),hook:address('0'),launchLocker:address('0'),graduationExecutor:address('0'),curveTradingEnabled:true,poolTradingEnabled:false,sourceVersion:1,launchPhase:0},source:{chainId:46630,blockNumber:'10',blockHash:hash('a'),transactionHash:hash('f'),transactionIndex:0,logIndex:0},identity:{name:'Quiet Market',symbol:'QUIET',metadataURI:'',deployedAt:String(timestamp-90000),blockNumber:'9',blockHash:hash('9'),runtimeCodeHash:hash('b')},display:{totalSupplyRaw,priceQuote:'0.0125',totalStakedRaw:'0',activeStakeRaw:'0',creatorTaxBps:0,asOfTimestamp:String(timestamp),blockNumber:'10',blockHash:hash('a')}} as any;
  const rpcCalls:string[]=[];
  try{
    try{await applyCoreMigration(db.pool,schemaName);}catch(error){if(process.env.TG_TEST_DISPLAY_DATABASE_URL||!['ECONNREFUSED','ENOENT','28P01','28000'].includes(String((error as {code?:string}).code)))throw error;context.skip('Local PostgreSQL unavailable for confirmed display integration test');return;}
    await db.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,9,$5,$6)`,[...id,hash('c'),hash('9'),hash('d')]);
    await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,10,$4,$5,true,true,to_timestamp($6))`,[...id,hash('a'),hash('9'),timestamp]);
    await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,9,$4,$5,true,true,to_timestamp($6))`,[...id,hash('9'),hash('8'),timestamp-90000]);
    const revision=`10:${hash('a')}`;
    await db.pool.query(`INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES($1,$2,$3,'analytics','integration-fixture',11,4,$4)`,[...id,revision]);
    await db.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,10,$5,1,$6,'{}')`,[...id,revision,hash('a'),hash('d')]);
    await db.pool.query(`INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES($1,$2,$3,'markets',$4)`,[...id,revision]);
    await db.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,$5,$5,$6,$7)`,[...id,revision,marketId,hash('e'),JSON.stringify(market)]);
    await db.pool.query(`INSERT INTO ${schema}.market_creation_directory(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index,market_id,payload) VALUES($1,$2,$3,$4,$5,0,$6,$7)`,[...id,hash('9'),hash('f'),marketId,JSON.stringify(creation)]);
    await db.pool.query(`INSERT INTO ${schema}.holder_balances(environment,chain_id,deployment_digest,market_id,account,balance_raw,excluded,block_hash,payload) VALUES($1,$2,$3,$4,$5,$6,false,$7,'{}')`,[...id,marketId,address('5'),totalSupplyRaw,hash('a')]);
    await db.pool.query(`INSERT INTO ${schema}.detail_fee_totals(environment,chain_id,deployment_digest,market_id,recipient,asset,amount_raw,block_hash) VALUES($1,$2,$3,$4,'platform',$5,'123',$6)`,[...id,marketId,quoteAsset,hash('a')]);
    await db.pool.query(`INSERT INTO ${schema}.confirmed_display_cursor(environment,chain_id,deployment_digest,block_number,block_hash,base_number,block_timestamp) VALUES($1,$2,$3,11,$4,10,$5)`,[...id,hash('b'),String(timestamp+1)]);
    const checkpointBefore=(await db.pool.query(`SELECT next_block::text,generation::text,last_revision FROM ${schema}.projection_checkpoints WHERE scope='analytics'`)).rows[0];
    const rpc=fakeRpc({head:12n,calls:rpcCalls});
    assert.equal(await advanceConfirmedDisplay({pool:db.pool,deployment,rpc,schemaName}),'initialized:rebase');
    assert.equal(await advanceConfirmedDisplay({pool:db.pool,deployment,rpc,schemaName}),'initialized:1');
    assert.equal(await advanceConfirmedDisplay({pool:db.pool,deployment,rpc,schemaName}),'confirmed:12:0');
    assert.ok(!rpcCalls.includes('eth_call'),`unexpected eth_call: ${rpcCalls.join(',')}`);
    const detail=await readConfirmedDetail(db.pool,deployment,marketId,'1H',schemaName);
    assert.ok(detail);
    assert.equal(detail.statistics?.price,'0.0125');
    assert.equal(detail.statistics?.marketCapUsd,null);
    assert.equal(detail.holders?.totalSupplyRaw,totalSupplyRaw);
    assert.equal(detail.holders?.count,1);
    assert.equal(detail.holders?.items[0]?.account,address('5'));
    assert.deepEqual(detail.trades,[]);
    assert.deepEqual(detail.fees,[{recipient:'platform',asset:quoteAsset,amountRaw:'123'}]);
    const checkpointAfter=(await db.pool.query(`SELECT next_block::text,generation::text,last_revision FROM ${schema}.projection_checkpoints WHERE scope='analytics'`)).rows[0];
    assert.deepEqual(checkpointAfter,checkpointBefore);
    // Simulate upgrading an existing quiet market whose last persisted execution
    // is outside the rolling 24h buffer. Only the background worker backfills it.
    const historicalTime=timestamp-90000;
    const trade={marketId,timestamp:String(historicalTime),side:'buy',price:{numerator:'1',denominator:'80'},memeRaw:'1000000000000000000',quoteRaw:'12500000000000000',actor:address('5'),classification:'unclassified',source:{chainId:46630,blockNumber:'9',blockHash:hash('9'),transactionHash:hash('e'),transactionIndex:0,logIndex:1,eventKey:'historical-trade'}};
    await db.pool.query(`INSERT INTO ${schema}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload) VALUES($1,$2,$3,$4,$5,$6,1,to_timestamp($7),'unclassified',$8,$9,$10)`,[...id,marketId,hash('9'),hash('e'),historicalTime,trade.memeRaw,trade.quoteRaw,JSON.stringify(trade)]);
    await db.pool.query(`UPDATE ${schema}.confirmed_display_markets SET payload=payload-'latestTrade'-'detailViews' WHERE market_id=$1`,[marketId]);
    assert.equal(await advanceConfirmedDisplay({pool:db.pool,deployment,rpc,schemaName}),'current');
    await db.pool.query(`UPDATE ${schema}.confirmed_display_markets SET refresh_due_at=now() WHERE market_id=$1`,[marketId]);
    const repaired=await refreshDisplayPreparation({pool:db.pool,deployment,schemaName});assert.equal(repaired.failed,0);
    const historical=await readConfirmedDetail(db.pool,deployment,marketId,'1H',schemaName);
    assert.deepEqual(historical?.chart?.points.filter(p=>p.price!==null),[{timestamp:Math.floor(historicalTime/60)*60,price:'0.0125'}]);
    assert.equal(historical?.statistics?.volume24h,'0');
    assert.deepEqual(historical?.trades,[]);
    assert.ok(!rpcCalls.includes('eth_call'));

  }finally{await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>undefined);await db.pool.end();}
});
