import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, getAbiItem, parseAbi, type Abi, type AbiEvent, type Address, type Hex } from 'viem';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { f72EventAbis } from '../../packages/events/src/f72-abis.generated.ts';
import { F72_RELEASE_ID, f72EventCatalog, protocolEventAbi } from '../../packages/events/src/index.ts';
import { projectF72History } from '../../packages/history-projector/src/index.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (character: string): Hex => `0x${character.repeat(64)}`;
const address = (character: string): Address => `0x${character.repeat(40)}`;
const ident = (value: string): string => { assert.match(value, /^[a-z][a-z0-9_]{0,62}$/); return `"${value}"`; };

for (const burnMode of [false,true]) test(`TS-10 history directories and payments (burn=${burnMode})`, { timeout: 30_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_MIGRATION_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_ts10_history_${process.pid}_${randomBytes(4).toString('hex')}`; const schema = ident(schemaName);
  const handle = createDatabasePool(connectionString, { max: 2 });
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: F72_RELEASE_ID, activationBlock: 1n };
  const marketId = hash('1'); const token = address('2'); const quote = address('3'); const creator = address('4'); const user = address('5');
  try {
    await applyCoreMigration(handle.pool, schemaName);
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES ('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest, hash('a'), hash('b'), hash('c')]);
    await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES ('test',46630,$1,1,$2,$3,true,true,to_timestamp(1001))`, [deployment.deploymentDigest, hash('b'), hash('a')]);
    await handle.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES ('test',46630,$1,'frontend-events',2,$2,0)`, [deployment.deploymentDigest, hash('b')]);
    const revision = `1:${hash('b')}`;
    await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,1,$3,0,$4,'{}')`, [deployment.deploymentDigest, revision, hash('b'), hash('d')]);
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,$3,$3,$4,$5)`,
      [deployment.deploymentDigest, revision, marketId, hash('e'), { marketId, memeToken: token, quoteAsset: quote, creator, creatorFeesToHolders: true, burnMemeFees: burnMode,
        source: { blockNumber: '1' }, identity: { name: 'Garden Token', symbol: 'GDN' } }]);
    await handle.pool.query(`INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES ('test',46630,$1,'markets',$2)`, [deployment.deploymentDigest, revision]);
    for (const [module, emitter] of [['HolderRewardsDistributorV1', f72EventCatalog.HolderRewardsDistributorV1.address],
      ['ProtocolFeeVault', f72EventCatalog.ProtocolFeeVault.address], ['TickerMemeTokenV1', token], ['TickerGardenFactoryV1', f72EventCatalog.TickerGardenFactoryV1.address]] as const) await handle.pool.query(
      `INSERT INTO ${schema}.contract_sources(environment,chain_id,deployment_digest,module,address,birth_block,runtime_code_hash) VALUES ('test',46630,$1,$2,$3,1,$4)`,
      [deployment.deploymentDigest, module, emitter, hash(module === 'ProtocolFeeVault' ? '6' : module === 'TickerMemeTokenV1' ? '7' : '8')]);
    await handle.pool.query(
      `INSERT INTO ${schema}.contract_sources(environment,chain_id,deployment_digest,module,address,birth_block,runtime_code_hash) VALUES ('test',46630,$1,'UniswapV4PoolManager',$2,1,$3)`,
      [deployment.deploymentDigest, f72EventCatalog.UniswapV4PoolManager.address, hash('9')]);
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'TickerGardenFactoryV1', 'MarketCreated',
      f72EventCatalog.TickerGardenFactoryV1.address, hash('8'), 0, { marketId, assetUid: hash('2'), memeToken: token, curve: address('7'), gauge: address('8'), quoteAsset: quote,
        tickerGardenBaselineId: hash('3'), quoteAssetConfigId: hash('4'), expectedEconomics: hash('5') });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'HolderRewardsDistributorV1', burnMode?'HolderSnapshotMarketRegistered':'HolderStreamMarketRegistered',
      f72EventCatalog.HolderRewardsDistributorV1.address, hash('9'), 0, { marketId, token, quote, vault: address('6') });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'TickerMemeTokenV1', 'Transfer', token, hash('a'), 1,
      { from: address('0'), to: user, value: 100n });
    // A shared PoolManager Swap is outside history's protocol event set. It must
    // not make otherwise valid history projection fail during decoder lookup.
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'UniswapV4PoolManager', 'Swap',
      f72EventCatalog.UniswapV4PoolManager.address, hash('d'), 2,
      { id: marketId, sender: user, amount0: 1n, amount1: -1n, sqrtPriceX96: 1n, liquidity: 1n, tick: 0, fee: 500 }, 1n, hash('b'));
    await saveRawLog(handle.pool, schema, deployment.deploymentDigest, f72EventCatalog.UniswapV4PoolManager.address,
      hash('d'), 3, '0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec', 1n, hash('b'));
    if(burnMode) {
      await saveEvent(handle.pool,schema,deployment.deploymentDigest,'HolderRewardsDistributorV1','HolderSnapshotClaimed',f72EventCatalog.HolderRewardsDistributorV1.address,hash('c'),3,{marketId,round:1n,account:user,assets:1,quotePaid:7n,memePaid:0n});
    } else {
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'HolderRewardsDistributorV1', 'HolderStreamClaimed',
      f72EventCatalog.HolderRewardsDistributorV1.address, hash('c'), 2, { marketId, account: user, asset: quote, amount: 99n });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'ProtocolFeeVault', 'UserRewardsClaimed', f72EventCatalog.ProtocolFeeVault.address,
      hash('c'), 3, { marketId, user, role: 2, creatorEpoch: 0, quotePaid: 7n, memePaid: 3n, memeRetained: 0n, memeConverted: 0n, conversionFailed: false });
    }
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'ProtocolFeeVault', 'FeeClaimed', f72EventCatalog.ProtocolFeeVault.address,
      hash('f'), 4, { beneficiaryType: 1, beneficiary: user, marketId, beneficiaryEpoch: 0, feeAsset: quote, amount: 5n });
    if(burnMode) await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'ProtocolFeeVault', 'MemeFeesBurned', f72EventCatalog.ProtocolFeeVault.address,
      hash('1'), 5, { marketId, beneficiary: user, role: 0, creatorEpoch: 1, token, amount: 11n });

    assert.deepEqual(await projectF72History({ pool: handle.pool, deployment, blockNumber: 1n, blockHash: hash('b'), generation: 0n, schemaName }),
      { rewards: burnMode?2:3, activities: burnMode?3:4, aggregates: 4 });
    const app = createReadApiApp({ pool: handle.pool, deployment, env: { NODE_ENV: 'test', TG_ENVIRONMENT: 'test', TG_READ_DATABASE_URL: connectionString,
      TG_CURSOR_SECRET: 'integration-cursor-secret-at-least-32-bytes', TG_DATABASE_SCHEMA: schemaName } });
    const creatorResponse = await app.request(`/v1/creator-markets?address=${creator}&limit=1`); assert.equal(creatorResponse.status, 200);
    assert.deepEqual((await creatorResponse.json() as { items: unknown[] }).items, [{ marketId, memeToken: token, creator, creationBlockNumber: '1' }]);
    const holderResponse = await app.request('/v1/holder-markets?q=gdn'); assert.equal(holderResponse.status, 200);
    assert.equal((await holderResponse.json() as { items: unknown[] }).items.length, 1);
    const walletResponse = await app.request(`/v1/wallet-holder-markets?account=${user}`); assert.equal(walletResponse.status, 200);
    assert.equal((await walletResponse.json() as { items: unknown[] }).items.length, 1);
    const holderHistory = await (await app.request(`/v1/holder-reward-history?marketId=${marketId}&account=${user}&throughBlock=1`)).json() as { claimed: Record<string, string>; complete: boolean };
    assert.equal(holderHistory.complete, true); assert.deepEqual(holderHistory.claimed, burnMode?{[quote]:'7'}:{ [quote]: '7', [token]: '3' });
    const stakerHistory = await (await app.request(`/v1/staker-reward-history?marketId=${marketId}&account=${user}&throughBlock=1`)).json() as { claimed: Record<string, string> };
    assert.deepEqual(stakerHistory.claimed, { [quote]: '5' });
    const activityResponse = await app.request(`/v1/users/${user}/activity?limit=2`); assert.equal(activityResponse.status, 200);
    const activity = await activityResponse.json() as { items: Array<{ id: string; roles: string[]; identityBasis: string }>; nextCursor: string | null; revision: string };
    assert.equal(activity.items.length, 2); assert.ok(activity.nextCursor); assert.match(activity.revision, /^sha256:[0-9a-f]{64}$/);
    assert.ok(activity.items.every((item) => item.id.endsWith(`:${user}`) && item.roles.length > 0
      && item.identityBasis === 'event_address_reference_not_verified_initiator'));
    const secondActivity = await app.request(`/v1/users/${user}/activity?limit=2&cursor=${encodeURIComponent(activity.nextCursor!)}`);
    assert.equal(secondActivity.status, 200); assert.equal((await secondActivity.json() as { items: unknown[] }).items.length, burnMode?1:2);
    const recovery = await (await app.request(`/v1/launch-recovery?marketId=${marketId}`)).json() as { transactionHash: string; finality: string };
    assert.equal(recovery.transactionHash, hash('8')); assert.equal(recovery.finality, 'finalized');
    if(!burnMode)return;
    const burns = await app.request(`/v1/meme-fee-burns?marketId=${marketId}`); assert.equal(burns.status, 200);
    assert.deepEqual((await burns.json() as { burns: Record<string, string> }).burns,
      { marketId, token, enabled: true, creatorRaw: '11', stakerRaw: '0', holderRaw: '0', totalRaw: '11' });
    await projectF72History({ pool: handle.pool, deployment, blockNumber: 1n, blockHash: hash('b'), generation: 0n, schemaName });
    assert.deepEqual((await (await app.request(`/v1/meme-fee-burns?marketId=${marketId}`)).json() as { burns: Record<string, string> }).burns,
      { marketId, token, enabled: true, creatorRaw: '11', stakerRaw: '0', holderRaw: '0', totalRaw: '11' });
    const before=(await handle.pool.query(`SELECT xmin::text version FROM ${schema}.aggregate_records WHERE scope='creator-market'`)).rows[0].version;
    const advance=async(nextHash:Hex)=>{
      await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES('test',46630,$1,2,$2,$3,true,true,to_timestamp(1002))`,[deployment.deploymentDigest,nextHash,hash('b')]);
      const nextRevision=`2:${nextHash}`;
      await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'markets',$2,2,$3,0,$4,'{}')`,[deployment.deploymentDigest,nextRevision,nextHash,hash('d')]);
      await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) SELECT environment,chain_id,deployment_digest,scope,$2,identity,sort_key,payload_digest,payload FROM ${schema}.projection_records WHERE deployment_digest=$1 AND scope='markets' AND revision=$3`,[deployment.deploymentDigest,nextRevision,revision]);
      await handle.pool.query(`UPDATE ${schema}.publication_pointers SET revision=$2 WHERE deployment_digest=$1 AND scope='markets'`,[deployment.deploymentDigest,nextRevision]);
      await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=3,last_block_hash=$2 WHERE deployment_digest=$1`,[deployment.deploymentDigest,nextHash]);
    };
    await advance(hash('6'));
    await saveEvent(handle.pool,schema,deployment.deploymentDigest,'ProtocolFeeVault','FeeClaimed',f72EventCatalog.ProtocolFeeVault.address,hash('7'),0,{beneficiaryType:1,beneficiary:user,marketId,beneficiaryEpoch:0,feeAsset:quote,amount:9n},2n,hash('6'));
    await projectF72History({pool:handle.pool,deployment,blockNumber:2n,blockHash:hash('6'),generation:0n,schemaName});
    assert.equal((await handle.pool.query(`SELECT sum(amount_raw)::text amount FROM ${schema}.reward_history WHERE kind='staker'`)).rows[0].amount,'14');
    assert.equal((await handle.pool.query(`SELECT xmin::text version FROM ${schema}.aggregate_records WHERE scope='creator-market'`)).rows[0].version,before,'unchanged creator aggregate is not rewritten');
    assert.deepEqual(await projectF72History({pool:handle.pool,deployment,blockNumber:2n,blockHash:hash('6'),generation:0n,schemaName}),{rewards:0,activities:0,aggregates:0});
    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false,finalized=false WHERE hash=$1`,[hash('6')]);
    assert.equal((await handle.pool.query(`SELECT next_block::text n,last_revision FROM ${schema}.projection_checkpoints WHERE scope='history'`)).rows[0].n,'2');
    assert.equal((await app.request(`/v1/creator-markets?address=${creator}`)).status,503,'orphan checkpoint cannot serve complete history');
    await advance(hash('7'));
    await saveEvent(handle.pool,schema,deployment.deploymentDigest,'ProtocolFeeVault','FeeClaimed',f72EventCatalog.ProtocolFeeVault.address,hash('9'),0,{beneficiaryType:1,beneficiary:user,marketId,beneficiaryEpoch:0,feeAsset:quote,amount:3n},2n,hash('7'));
    await projectF72History({pool:handle.pool,deployment,blockNumber:2n,blockHash:hash('7'),generation:0n,schemaName});
    assert.equal((await handle.pool.query(`SELECT sum(amount_raw)::text amount FROM ${schema}.reward_history WHERE kind='staker'`)).rows[0].amount,'8');
    assert.equal((await handle.pool.query(`SELECT xmin::text version FROM ${schema}.aggregate_records WHERE scope='creator-market'`)).rows[0].version,before);
    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false,finalized=false WHERE number>=1`);
    await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES ('test',46630,$1,2,$2,$3,true,true,to_timestamp(1002))`, [deployment.deploymentDigest, hash('c'), hash('b')]);
    const revision2 = `2:${hash('c')}`;
    await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,2,$3,0,$4,'{}')`, [deployment.deploymentDigest, revision2, hash('c'), hash('d')]);
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) SELECT environment,chain_id,deployment_digest,scope,$2,identity,sort_key,$4,payload FROM ${schema}.projection_records WHERE deployment_digest=$1 AND scope='markets' AND revision=$3`, [deployment.deploymentDigest, revision2, revision, hash('d')]);
    await handle.pool.query(`UPDATE ${schema}.publication_pointers SET revision=$2 WHERE environment='test' AND chain_id=46630 AND deployment_digest=$1 AND scope='markets'`, [deployment.deploymentDigest, revision2]);
    await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=3,last_block_hash=$2 WHERE environment='test' AND chain_id=46630 AND deployment_digest=$1 AND stream='frontend-events'`, [deployment.deploymentDigest, hash('c')]);
    await projectF72History({ pool: handle.pool, deployment, blockNumber: 2n, blockHash: hash('c'), generation: 0n, schemaName });
    assert.deepEqual((await (await app.request(`/v1/meme-fee-burns?marketId=${marketId}`)).json() as { burns: Record<string, string> }).burns,
      { marketId, token, enabled: true, creatorRaw: '0', stakerRaw: '0', holderRaw: '0', totalRaw: '0' });
    await assert.rejects(()=>projectF72History({pool:handle.pool,deployment,blockNumber:1n,blockHash:hash('b'),generation:0n,schemaName}));
    const numbered=(n:number)=>('0x'+n.toString(16).padStart(64,'0')) as Hex;
    for(let number=3;number<=259;number++){
      await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES('test',46630,$1,$2,$3,$4,true,true,to_timestamp($5))`,[deployment.deploymentDigest,number,numbered(number),number===3?hash('c'):numbered(number-1),1000+number]);
      await saveEvent(handle.pool,schema,deployment.deploymentDigest,'ProtocolFeeVault','FeeClaimed',f72EventCatalog.ProtocolFeeVault.address,numbered(1000+number),0,{beneficiaryType:1,beneficiary:user,marketId,beneficiaryEpoch:0,feeAsset:quote,amount:1n},BigInt(number),numbered(number));
    }
    const finalRevision=`259:${numbered(259)}`;
    await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'markets',$2,259,$3,0,$4,'{}')`,[deployment.deploymentDigest,finalRevision,numbered(259),hash('d')]);
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) SELECT environment,chain_id,deployment_digest,scope,$2,identity,sort_key,payload_digest,payload FROM ${schema}.projection_records WHERE deployment_digest=$1 AND scope='markets' AND revision=$3`,[deployment.deploymentDigest,finalRevision,revision]);
    await handle.pool.query(`UPDATE ${schema}.publication_pointers SET revision=$2 WHERE deployment_digest=$1 AND scope='markets'`,[deployment.deploymentDigest,finalRevision]);
    await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=260,last_block_hash=$2 WHERE deployment_digest=$1`,[deployment.deploymentDigest,numbered(259)]);
    const job={pool:handle.pool,deployment,blockNumber:259n,blockHash:numbered(259),generation:0n,schemaName};
    await assert.rejects(()=>projectF72History(job),/history projection continuation required/);
    assert.equal((await handle.pool.query(`SELECT next_block::text n FROM ${schema}.projection_checkpoints WHERE scope='history'`)).rows[0].n,'259');
    await projectF72History(job);
    assert.equal((await handle.pool.query(`SELECT sum(amount_raw)::text amount FROM ${schema}.reward_history WHERE kind='staker'`)).rows[0].amount,'257');
    assert.deepEqual(await projectF72History(job),{rewards:0,activities:0,aggregates:0});


  } finally { await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end(); }
});

async function saveEvent(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, deploymentDigest: string,
  module: keyof typeof f72EventAbis, eventName: string, emitter: Address, transactionHash: Hex, logIndex: number, args: Record<string, unknown>,blockNumber=1n,blockHash=hash('b')): Promise<void> {
  const abi = eventName === 'MemeFeesBurned' ? parseAbi(['event MemeFeesBurned(bytes32 indexed marketId,address indexed beneficiary,uint8 indexed role,uint32 creatorEpoch,address token,uint256 amount)']) : eventName.startsWith('HolderSnapshot') ? protocolEventAbi(module) : f72EventAbis[module] as Abi;
  const item = getAbiItem({ abi, name: eventName }) as AbiEvent;
  const topics = encodeEventTopics({ abi, eventName, args }); const inputs = item.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(inputs, inputs.map((input) => args[input.name!] as never));
  const payload = { address: emitter, blockNumber: String(blockNumber), blockHash, transactionHash, transactionIndex: '0', logIndex: String(logIndex), data, topics, removed: false };
  await pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload)
    VALUES ('test',46630,$1,$2,$3,0,$4,$5,$6,$7)`, [deploymentDigest, blockHash, transactionHash, logIndex, emitter, topics[0], payload]);
}

async function saveRawLog(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, deploymentDigest: string,
  emitter: Address, transactionHash: Hex, logIndex: number, topic0: Hex, blockNumber=1n, blockHash=hash('b')): Promise<void> {
  const payload = { address: emitter, blockNumber: String(blockNumber), blockHash, transactionHash, transactionIndex: '0', logIndex: String(logIndex), data: '0x', topics: [topic0], removed: false };
  await pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload)
    VALUES ('test',46630,$1,$2,$3,0,$4,$5,$6,$7)`, [deploymentDigest, blockHash, transactionHash, logIndex, emitter, topic0, payload]);
}
