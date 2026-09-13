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
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'TickerGardenFactoryV1', 'MarketCreated',
      f72EventCatalog.TickerGardenFactoryV1.address, hash('8'), 0, { marketId, assetUid: hash('2'), memeToken: token, curve: address('7'), gauge: address('8'), quoteAsset: quote,
        tickerGardenBaselineId: hash('3'), quoteAssetConfigId: hash('4'), expectedEconomics: hash('5') });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'HolderRewardsDistributorV1', burnMode?'HolderSnapshotMarketRegistered':'HolderStreamMarketRegistered',
      f72EventCatalog.HolderRewardsDistributorV1.address, hash('9'), 0, { marketId, token, quote, vault: address('6') });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'TickerMemeTokenV1', 'Transfer', token, hash('a'), 1,
      { from: address('0'), to: user, value: 100n });
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
    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false,finalized=false WHERE number=1`);
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

  } finally { await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end(); }
});

async function saveEvent(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, deploymentDigest: string,
  module: keyof typeof f72EventAbis, eventName: string, emitter: Address, transactionHash: Hex, logIndex: number, args: Record<string, unknown>): Promise<void> {
  const abi = eventName === 'MemeFeesBurned' ? parseAbi(['event MemeFeesBurned(bytes32 indexed marketId,address indexed beneficiary,uint8 indexed role,uint32 creatorEpoch,address token,uint256 amount)']) : eventName.startsWith('HolderSnapshot') ? protocolEventAbi(module) : f72EventAbis[module] as Abi;
  const item = getAbiItem({ abi, name: eventName }) as AbiEvent;
  const topics = encodeEventTopics({ abi, eventName, args }); const inputs = item.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(inputs, inputs.map((input) => args[input.name!] as never));
  const payload = { address: emitter, blockNumber: '1', blockHash: hash('b'), transactionHash, transactionIndex: '0', logIndex: String(logIndex), data, topics, removed: false };
  await pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload)
    VALUES ('test',46630,$1,$2,$3,0,$4,$5,$6,$7)`, [deploymentDigest, hash('b'), transactionHash, logIndex, emitter, topics[0], payload]);
}
