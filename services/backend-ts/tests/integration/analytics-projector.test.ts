import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Abi, type AbiEvent } from 'viem';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { projectF72Analytics } from '../../packages/analytics-projector/src/index.ts';
import { f72EventAbis } from '../../packages/events/src/f72-abis.generated.ts';
import { F72_RELEASE_ID, f72EventCatalog } from '../../packages/events/src/index.ts';
import { f72BootstrapConfigs, type BootstrapConfig } from '../../packages/config-projector/src/f72-bootstrap.generated.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (character: string): `0x${string}` => `0x${character.repeat(64)}`;
const address = (character: string): `0x${string}` => `0x${character.repeat(40)}`;
const ident = (value: string): string => { assert.match(value, /^[a-z][a-z0-9_]{0,62}$/); return `"${value}"`; };

test('TS-07 analytics projector advances trades and holder balances incrementally', { timeout: 30_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_MIGRATION_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_ts07_project_${process.pid}_${randomBytes(4).toString('hex')}`; const schema = ident(schemaName);
  const handle = createDatabasePool(connectionString, { max: 2 });
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: F72_RELEASE_ID, activationBlock: 1n };
  const marketId = hash('1'); const token = address('2'); const curve = address('3'); const gauge = address('4');
  const quote = f72BootstrapConfigs.find((item) => item.kind === 'quote' && 'quoteAsset' in item.values
    && item.values.quoteAsset === '0x0000000000000000000000000000000000000000') as BootstrapConfig & { kind: 'quote'; values: { quoteAsset: `0x${string}` } };
  const baseline = f72BootstrapConfigs.find((item) => item.kind === 'baseline') as BootstrapConfig & { kind: 'baseline'; values: { supply: string } };
  try {
    await applyCoreMigration(handle.pool, schemaName);
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES ('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest, hash('a'), hash('b'), hash('c')]);
    for (const [number, blockHash, parentHash] of [[1, hash('b'), hash('a')], [2, hash('c'), hash('b')], [3, hash('d'), hash('c')]] as const) await handle.pool.query(
      `INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES ('test',46630,$1,$2,$3,$4,true,true,to_timestamp($5))`,
      [deployment.deploymentDigest, number, blockHash, parentHash, 1_000 + number]);
    for (const [module, source] of [['TickerMemeTokenV1', token], ['TickerGardenCurve', curve],
      ['ProtocolFeeVault', f72EventCatalog.ProtocolFeeVault.address], ['UniswapV4PoolManager', f72EventCatalog.UniswapV4PoolManager.address]] as const) await handle.pool.query(
      `INSERT INTO ${schema}.contract_sources(environment,chain_id,deployment_digest,module,address,birth_block,runtime_code_hash) VALUES ('test',46630,$1,$2,$3,1,$4)`,
      [deployment.deploymentDigest, module, source, hash(module === 'TickerMemeTokenV1' ? '5' : module === 'TickerGardenCurve' ? '6' : 'a')]);
    await saveLog(handle.pool, schema, deployment.deploymentDigest, 'TickerMemeTokenV1', 'Transfer', token, 1, hash('b'), hash('7'), 0,
      { from: address('0'), to: curve, value: BigInt(baseline.values.supply) });
    await saveLog(handle.pool, schema, deployment.deploymentDigest, 'TickerGardenCurve', 'CurveBuy', curve, 2, hash('c'), hash('8'), 0,
      { buyer: address('9'), recipient: address('9'), quoteIn: 103n, tokensOut: 100n, fee: 2n, tax: 1n });
    await savePoolManagerLog(handle.pool, schema, deployment.deploymentDigest, 2, hash('c'), hash('8'), 1,
      { id: hash('6'), sender: address('9'), amount0: 1n, amount1: -1n, sqrtPriceX96: 1n, liquidity: 1n, tick: 0, fee: 500 });
    await saveRawLog(handle.pool, schema, deployment.deploymentDigest, 2, hash('c'), hash('8'), 2,
      '0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec');
    await publishMarket(handle.pool, schema, deployment.deploymentDigest, 2, hash('c'), { marketId, memeToken: token, curve, gauge,
      quoteAsset: quote.values.quoteAsset, quoteAssetConfigId: quote.id, tickerGardenBaselineId: baseline.id, poolId: null, poolKey: null, source: { blockNumber: '1' } });
    assert.deepEqual(await projectF72Analytics({ pool: handle.pool, deployment, blockNumber: 2n, blockHash: hash('c'), generation: 0n, schemaName }), { trades: 1, holders: 1 });
    const first = await handle.pool.query<{ balance_raw: string }>(`SELECT balance_raw::text FROM ${schema}.holder_balances WHERE market_id=$1 AND account=$2`, [marketId, curve]);
    assert.equal(first.rows[0]?.balance_raw, baseline.values.supply);

    await saveLog(handle.pool, schema, deployment.deploymentDigest, 'TickerMemeTokenV1', 'Transfer', token, 3, hash('d'), hash('9'), 0,
      { from: curve, to: address('9'), value: 250n });
    await saveLog(handle.pool, schema, deployment.deploymentDigest, 'TickerMemeTokenV1', 'Transfer', token, 3, hash('d'), hash('9'), 3,
      { from: address('9'), to: address('0'), value: 25n });
    await saveLog(handle.pool, schema, deployment.deploymentDigest, 'TickerGardenCurve', 'CurveSell', curve, 3, hash('d'), hash('9'), 1,
      { seller: address('9'), recipient: address('9'), tokensIn: 10n, quoteOut: 8n, fee: 1n, tax: 1n });
    await saveLog(handle.pool, schema, deployment.deploymentDigest, 'ProtocolFeeVault', 'FeeBucketsCredited',
      f72EventCatalog.ProtocolFeeVault.address, 3, hash('d'), hash('9'), 2,
      { marketId, creatorEpoch: 1, feeAsset: quote.values.quoteAsset, feeId: hash('2'), creatorAmount: 7n,
        stakerAmount: 5n, platformAmount: 3n, activeStock: 100n });
    await publishMarket(handle.pool, schema, deployment.deploymentDigest, 3, hash('d'), { marketId, memeToken: token, curve, gauge,
      quoteAsset: quote.values.quoteAsset, quoteAssetConfigId: quote.id, tickerGardenBaselineId: baseline.id, poolId: null, poolKey: null, source: { blockNumber: '1' } });
    assert.deepEqual(await projectF72Analytics({ pool: handle.pool, deployment, blockNumber: 3n, blockHash: hash('d'), generation: 0n, schemaName }), { trades: 1, holders: 2 });
    const counts = await handle.pool.query<{ trades: string; user_balance: string; total_supply: string; positive: string; next_block: string; fee_total: string; fee_events:string }>(
      `SELECT (SELECT count(*)::text FROM ${schema}.market_trades) trades,
       (SELECT balance_raw::text FROM ${schema}.holder_balances WHERE market_id=$1 AND account=$2) user_balance,
       (SELECT total_supply_raw::text FROM ${schema}.holder_snapshots WHERE market_id=$1) total_supply,
       (SELECT positive_address_count::text FROM ${schema}.holder_snapshots WHERE market_id=$1) positive,
       (SELECT next_block::text FROM ${schema}.projection_checkpoints WHERE scope='analytics') next_block,
       (SELECT sum(amount_raw)::text FROM ${schema}.detail_fee_totals WHERE market_id=$1) fee_total,
       (SELECT count(*)::text FROM ${schema}.detail_fee_events WHERE market_id=$1) fee_events`, [marketId, address('9')]);
    assert.deepEqual(counts.rows[0], { trades: '2', user_balance: '225', total_supply: (BigInt(baseline.values.supply) - 25n).toString(), positive: '2', next_block: '4', fee_total: '15', fee_events:'3' });
  } finally {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end();
  }
});

async function publishMarket(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, deploymentDigest: string,
  number: number, blockHash: `0x${string}`, payload: Record<string, unknown>): Promise<void> {
  const revision = `${number}:${blockHash}`;
  await pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,$3,$4,0,$5,'{}')`, [deploymentDigest, revision, number, blockHash, hash(number === 2 ? 'e' : 'f')]);
  await pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,$3,$3,$4,$5)`, [deploymentDigest, revision, payload.marketId, hash(number === 2 ? 'e' : 'f'), payload]);
  await pool.query(`INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES ('test',46630,$1,'markets',$2) ON CONFLICT (environment,chain_id,deployment_digest,scope) DO UPDATE SET revision=excluded.revision`, [deploymentDigest, revision]);
}

async function saveLog(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, deploymentDigest: string,
  module: 'TickerMemeTokenV1' | 'TickerGardenCurve' | 'ProtocolFeeVault', eventName: string, emitter: `0x${string}`, blockNumber: number,
  blockHash: `0x${string}`, transactionHash: `0x${string}`, logIndex: number, args: Record<string, unknown>): Promise<void> {
  const abi = f72EventAbis[module] as Abi; const item = getAbiItem({ abi, name: eventName }) as AbiEvent;
  const topics = encodeEventTopics({ abi, eventName, args });
  const inputs = item.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(inputs, inputs.map((input) => args[input.name!] as never));
  const payload = { address: emitter, blockNumber: String(blockNumber), blockHash, transactionHash, transactionIndex: '0', logIndex: String(logIndex), data, topics, removed: false };
  await pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) VALUES ('test',46630,$1,$2,$3,0,$4,$5,$6,$7)`, [deploymentDigest, blockHash, transactionHash, logIndex, emitter, topics[0], payload]);
}

async function savePoolManagerLog(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, deploymentDigest: string,
  blockNumber: number, blockHash: `0x${string}`, transactionHash: `0x${string}`, logIndex: number, args: Record<string, unknown>): Promise<void> {
  const abi = f72EventAbis.UniswapV4PoolManager as Abi; const item = getAbiItem({ abi, name: 'Swap' }) as AbiEvent;
  const topics = encodeEventTopics({ abi, eventName: 'Swap', args });
  const inputs = item.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(inputs, inputs.map((input) => args[input.name!] as never));
  const payload = { address: f72EventCatalog.UniswapV4PoolManager.address, blockNumber: String(blockNumber), blockHash, transactionHash, transactionIndex: '0', logIndex: String(logIndex), data, topics, removed: false };
  await pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) VALUES ('test',46630,$1,$2,$3,0,$4,$5,$6,$7)`, [deploymentDigest, blockHash, transactionHash, logIndex, f72EventCatalog.UniswapV4PoolManager.address, topics[0], payload]);
}

async function saveRawLog(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, deploymentDigest: string,
  blockNumber: number, blockHash: `0x${string}`, transactionHash: `0x${string}`, logIndex: number, topic0: `0x${string}`): Promise<void> {
  const payload = { address: f72EventCatalog.UniswapV4PoolManager.address, blockNumber: String(blockNumber), blockHash, transactionHash, transactionIndex: '0', logIndex: String(logIndex), data: '0x', topics: [topic0], removed: false };
  await pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) VALUES ('test',46630,$1,$2,$3,0,$4,$5,$6,$7)`, [deploymentDigest, blockHash, transactionHash, logIndex, f72EventCatalog.UniswapV4PoolManager.address, topic0, payload]);
}
