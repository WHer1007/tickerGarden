import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Abi, type AbiEvent, type Address, type Hex } from 'viem';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { f72EventAbis } from '../../packages/events/src/f72-abis.generated.ts';
import { F72_RELEASE_ID, f72EventCatalog, protocolEventAbi } from '../../packages/events/src/index.ts';
import { projectF72History } from '../../packages/history-projector/src/index.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (character: string): Hex => `0x${character.repeat(64)}`;
const address = (character: string): Address => `0x${character.repeat(40)}`;
const ident = (value: string): string => { assert.match(value, /^[a-z][a-z0-9_]{0,62}$/); return `"${value}"`; };

test('creator rewards integrate curve pending fees, sweep credits, claims, handoff epochs, discovery and reorg rollback', { timeout: 30_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_MIGRATION_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_creator_rewards_${process.pid}_${randomBytes(4).toString('hex')}`; const schema = ident(schemaName);
  const handle = createDatabasePool(connectionString, { max: 2 });
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: F72_RELEASE_ID, activationBlock: 1n };
  const marketId = hash('1'), token = address('2'), quote = address('3'), oldOwner = address('4'), user = address('5'), nextOwner = address('6');
  try {
    await applyCoreMigration(handle.pool, schemaName);
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES ('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest, hash('a'), hash('b'), hash('c')]);
    await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES ('test',46630,$1,1,$2,$3,true,true,to_timestamp(1001))`, [deployment.deploymentDigest, hash('b'), hash('a')]);
    await handle.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES ('test',46630,$1,'frontend-events',2,$2,0)`, [deployment.deploymentDigest, hash('b')]);
    const revision = `1:${hash('b')}`;
    await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,1,$3,0,$4,'{}')`, [deployment.deploymentDigest, revision, hash('b'), hash('d')]);
    const market = { marketId, memeToken: token, quoteAsset: quote, creator: oldOwner, creatorFeesToHolders: false, burnMemeFees: true, creatorTaxBps: 200,
      creatorRevenueBeneficiaryAtCreation: oldOwner, curve: address('7'), source: { blockNumber: '1' }, identity: { name: 'Creator Market', symbol: 'CRM' } };
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,$3,$3,$4,$5)`,
      [deployment.deploymentDigest, revision, marketId, hash('e'), market]);
    await handle.pool.query(`INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES ('test',46630,$1,'markets',$2)`, [deployment.deploymentDigest, revision]);
    for (const [module, emitter] of [['CreatorRevenueRegistry', address('9')], ['ProtocolFeeVault', f72EventCatalog.ProtocolFeeVault.address], ['TickerGardenFactoryV1', f72EventCatalog.TickerGardenFactoryV1.address], ['TickerGardenCurve', market.curve]] as const) {
      await handle.pool.query(`INSERT INTO ${schema}.contract_sources(environment,chain_id,deployment_digest,module,address,birth_block,runtime_code_hash) VALUES ('test',46630,$1,$2,$3,1,$4)`,
        [deployment.deploymentDigest, module, emitter, hash('8')]);
    }
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'CreatorRevenueRegistry', 'CreatorRevenueEpochInitialized', address('9'), hash('8'), 0,
      { marketId, epoch: 1, beneficiary: oldOwner });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'TickerGardenCurve', 'CurveBuy', market.curve, hash('8'), 10,
      { buyer: user, recipient: user, quoteIn: 1000n, tokensOut: 1n, fee: 10n, tax: 20n });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'ProtocolFeeVault', 'CurveFeesSwept', f72EventCatalog.ProtocolFeeVault.address, hash('8'), 11,
      { marketId, creatorEpoch: 1, quoteAsset: quote, sweepNonce: 1n, feeId: hash('a'), amount: 30n, creatorAmount: 27n, platformAmount: 3n });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'CreatorRevenueRegistry', 'CreatorRevenueBeneficiaryProposed', address('9'), hash('8'), 12,
      { marketId, epoch: 1, currentBeneficiary: oldOwner, pendingBeneficiary: nextOwner });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'CreatorRevenueRegistry', 'CreatorRevenueBeneficiaryTransferCancelled', address('9'), hash('8'), 13,
      { marketId, epoch: 1 });
    // MarketCreated is needed for normal directory materialization; the market record is already published above.
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'TickerGardenFactoryV1', 'MarketCreated', f72EventCatalog.TickerGardenFactoryV1.address, hash('8'), 14,
      { marketId, assetUid: hash('2'), memeToken: token, curve: market.curve, gauge: address('8'), quoteAsset: quote,
        tickerGardenBaselineId: hash('3'), quoteAssetConfigId: hash('4'), expectedEconomics: hash('5') });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'ProtocolFeeVault', 'FeeBucketsCredited', f72EventCatalog.ProtocolFeeVault.address, hash('8'), 15,
      { marketId, creatorEpoch: 1, feeAsset: quote, feeId: hash('c'), creatorAmount: 23n, stakerAmount: 0n, platformAmount: 7n, activeStock: 0n });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'ProtocolFeeVault', 'FeeClaimed', f72EventCatalog.ProtocolFeeVault.address, hash('8'), 16,
      { beneficiaryType: 0, beneficiary: oldOwner, marketId, beneficiaryEpoch: 1, feeAsset: quote, amount: 5n });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'ProtocolFeeVault', 'MemeFeesBurned', f72EventCatalog.ProtocolFeeVault.address, hash('8'), 19,
      { marketId, beneficiary: oldOwner, role: 0, creatorEpoch: 1, token, amount: 2n });
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'ProtocolFeeVault', 'FeeBucketsCredited', f72EventCatalog.ProtocolFeeVault.address, hash('8'), 17,
      { marketId, creatorEpoch: 1, feeAsset: token, feeId: hash('b'), creatorAmount: 12n, stakerAmount: 4n, platformAmount: 1n, activeStock: 0n });
    await projectF72History({ pool: handle.pool, deployment, blockNumber: 1n, blockHash: hash('b'), generation: 0n, schemaName });
    const app = createReadApiApp({ pool: handle.pool, deployment, env: { NODE_ENV: 'test', TG_ENVIRONMENT: 'test', TG_READ_DATABASE_URL: connectionString,
      TG_CURSOR_SECRET: 'integration-creator-cursor-secret-is-long-enough', TG_DATABASE_SCHEMA: schemaName } });
    const pendingBeforeHandoff = await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${oldOwner}`);
    assert.equal(pendingBeforeHandoff.status, 200);
    const pendingState = await pendingBeforeHandoff.json() as any;
    assert.equal(pendingState.currentEpoch, 1); assert.equal(pendingState.pendingBeneficiary, address('0'));
    assert.equal(pendingState.pendingQuote, '0', 'curve fees were swept before the epoch 1 checkpoint');
    await addBlock(handle.pool, schema, deployment.deploymentDigest, 2, hash('c'), hash('b'));
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'CreatorRevenueRegistry', 'CreatorRevenueBeneficiaryProposed', address('9'), hash('a'), 0,
      { marketId, epoch: 1, currentBeneficiary: oldOwner, pendingBeneficiary: nextOwner }, 2n, hash('c'));
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'CreatorRevenueRegistry', 'CreatorRevenueBeneficiaryUpdated', address('9'), hash('a'), 1,
      { marketId, oldBeneficiary: oldOwner, newBeneficiary: nextOwner, oldEpoch: 1, newEpoch: 2 }, 2n, hash('c'));
    await publishMarketRevision(handle.pool, schema, deployment.deploymentDigest, revision, 2, hash('c'));
    await projectF72History({ pool: handle.pool, deployment, blockNumber: 2n, blockHash: hash('c'), generation: 0n, schemaName });
    const oldResult = await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${oldOwner}`);
    assert.equal(oldResult.status, 200);
    const oldData = await oldResult.json() as any;
    assert.equal(oldData.currentEpoch, 2); assert.equal(oldData.currentBeneficiary, nextOwner); assert.equal(oldData.pendingBeneficiary, address('0'));
    assert.deepEqual(oldData.periods, [{ epoch: 1, beneficiary: oldOwner,
      quote: { credited: '50', paid: '5', burned: '0', remaining: '45' }, meme: { credited: '12', paid: '0', burned: '2', remaining: '10' } }]);
    assert.equal(oldData.pendingQuote, '0');
    const newResult = await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${nextOwner}`);
    assert.equal(newResult.status, 200);
    const newData = await newResult.json() as any;
    assert.equal(newData.currentBeneficiary, nextOwner); assert.deepEqual(newData.periods, [{ epoch: 2, beneficiary: nextOwner,
      quote: { credited: '0', paid: '0', burned: '0', remaining: '0' }, meme: { credited: '0', paid: '0', burned: '0', remaining: '0' } }]);
    const curvePending = await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${nextOwner}&epoch=2`);
    assert.equal((await curvePending.json() as any).pendingQuote, '0', 'old owner keeps pre-handoff curve pending accounting');
    const discover = await app.request(`/v1/creator-markets?address=${nextOwner}`);
    assert.equal(discover.status, 200); assert.equal((await discover.json() as any).items[0].creator, nextOwner);

    await handle.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false,finalized=false WHERE hash=$1`, [hash('c')]);
    await handle.pool.query(`UPDATE ${schema}.chain_logs SET canonical=false WHERE block_hash=$1`, [hash('c')]);
    const orphanRead = await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${oldOwner}`);
    assert.equal(orphanRead.status, 503, 'creator reads exclude data anchored to a reorged block');
    await addBlock(handle.pool, schema, deployment.deploymentDigest, 2, hash('d'), hash('b'));
    await saveEvent(handle.pool, schema, deployment.deploymentDigest, 'CreatorRevenueRegistry', 'CreatorRevenueBeneficiaryProposed', address('9'), hash('b'), 0,
      { marketId, epoch: 1, currentBeneficiary: oldOwner, pendingBeneficiary: nextOwner }, 2n, hash('d'));
    await publishMarketRevision(handle.pool, schema, deployment.deploymentDigest, revision, 2, hash('d'));
    await projectF72History({ pool: handle.pool, deployment, blockNumber: 2n, blockHash: hash('d'), generation: 0n, schemaName });
    const replacementRead = await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${oldOwner}`);
    assert.equal(replacementRead.status, 200);
    const replacement = await replacementRead.json() as any;
    assert.equal(replacement.currentEpoch, 1, 'accepted epoch 2 is removed by the orphan replay');
    assert.equal(replacement.currentBeneficiary, oldOwner);
    assert.equal(replacement.pendingBeneficiary, nextOwner, 'replacement branch proposal state replaces the accepted handoff');
    assert.deepEqual(replacement.periods, pendingState.periods, 'epoch 1 balances roll back to the prior checkpoint');
    assert.equal((await handle.pool.query(`SELECT count(*)::int n FROM ${schema}.creator_reward_epochs e JOIN ${schema}.chain_blocks b ON b.environment=e.environment AND b.chain_id=e.chain_id AND b.deployment_digest=e.deployment_digest AND b.hash=e.block_hash WHERE e.deployment_digest=$1 AND e.epoch=2 AND b.canonical`, [deployment.deploymentDigest])).rows[0].n, 0,
      'orphan epoch 2 is not materialized on the replacement branch');
    const pendingWallet = await (await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${nextOwner}`)).json() as any;
    assert.deepEqual(pendingWallet.periods, []);
    assert.equal(pendingWallet.pendingBeneficiary, nextOwner, 'pending recipient is visible without an owned epoch');
    assert.equal((await (await app.request(`/v1/creator-markets?address=${nextOwner}`)).json() as any).items.length,1);
    // Persisted high-epoch fixture checks pagination independently of event throughput.
    await handle.pool.query(`INSERT INTO ${schema}.creator_reward_epochs SELECT 'test',46630,$1,$2,e,$3,$4 FROM generate_series(2,23) e`,[deployment.deploymentDigest,marketId,oldOwner,hash('b')]);
    await handle.pool.query(`UPDATE ${schema}.aggregate_records SET payload=jsonb_set(payload,'{currentEpoch}','23') WHERE scope='creator-state' AND identity=$1`,[marketId]);
    const first=await (await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${oldOwner}`)).json() as any;
    assert.equal(first.periods.length,20);assert.equal(first.periods[0].epoch,23);assert.ok(first.nextCursor);
    const second=await (await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${oldOwner}&cursor=${encodeURIComponent(first.nextCursor)}`)).json() as any;
    assert.deepEqual(second.periods.map((p:any)=>p.epoch),[3,2,1]);assert.equal(second.nextCursor,null);
    assert.equal((await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${nextOwner}&cursor=${encodeURIComponent(first.nextCursor)}`)).status,409,'cursor is wallet-bound');
    const selected=await (await app.request(`/v1/creator-rewards?marketId=${marketId}&account=${oldOwner}&epoch=1`)).json() as any;
    assert.equal(selected.periods.length,1);assert.equal(selected.periods[0].quote.remaining,'45');
  } finally { await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end(); }
});

async function saveEvent(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, deploymentDigest: string,
  module: keyof typeof f72EventAbis, eventName: string, emitter: Address, transactionHash: Hex, logIndex: number, args: Record<string, unknown>, blockNumber=1n, blockHash=hash('b')): Promise<void> {
  const abi = f72EventAbis[module] as Abi; const item = getAbiItem({ abi: protocolEventAbi(module), name: eventName }) as AbiEvent;
  const topics = encodeEventTopics({ abi: protocolEventAbi(module), eventName, args }); const inputs = item.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(inputs, inputs.map((input) => args[input.name!] as never));
  const payload = { address: emitter, blockNumber: String(blockNumber), blockHash, transactionHash, transactionIndex: '0', logIndex: String(logIndex), data, topics, removed: false };
  await pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload)
    VALUES ('test',46630,$1,$2,$3,0,$4,$5,$6,$7)`, [deploymentDigest, blockHash, transactionHash, logIndex, emitter, topics[0], payload]);
}

async function addBlock(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, digest: string, number: number, blockHash: Hex, parentHash: Hex) {
  await pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES('test',46630,$1,$2,$3,$4,true,true,to_timestamp($5))`,
    [digest, number, blockHash, parentHash, 1000 + number]);
  await pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=$2,last_block_hash=$3 WHERE environment='test' AND chain_id=46630 AND deployment_digest=$1 AND stream='frontend-events'`,
    [digest, number + 1, blockHash]);
}

async function publishMarketRevision(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, digest: string, priorRevision: string, number: number, blockHash: Hex) {
  const revision = `${number}:${blockHash}`;
  await pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'markets',$2,$3,$4,0,$5,'{}')`,
    [digest, revision, number, blockHash, hash('d')]);
  await pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) SELECT environment,chain_id,deployment_digest,scope,$2,identity,sort_key,payload_digest,payload FROM ${schema}.projection_records WHERE deployment_digest=$1 AND scope='markets' AND revision=$3`,
    [digest, revision, priorRevision]);
  await pool.query(`UPDATE ${schema}.publication_pointers SET revision=$2 WHERE environment='test' AND chain_id=46630 AND deployment_digest=$1 AND scope='markets'`, [digest, revision]);
}
