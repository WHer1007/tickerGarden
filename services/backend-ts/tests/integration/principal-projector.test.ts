import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAbiItem, type Abi, type AbiEvent, type Address, type Hex } from 'viem';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { f72EventAbis, f72ReadAbis } from '../../packages/events/src/f72-abis.generated.ts';
import { F72_RELEASE_ID, fixedF72Sources } from '../../packages/events/src/index.ts';
import { projectF72Principal } from '../../packages/principal-projector/src/index.ts';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import { f72BootstrapConfigs } from '../../packages/config-projector/src/f72-bootstrap.generated.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (character: string): Hex => `0x${character.repeat(64)}`;
const address = (character: string): Address => `0x${character.repeat(40)}`;
const ident = (value: string): string => { assert.match(value, /^[a-z][a-z0-9_]{0,62}$/); return `"${value}"`; };

test('TS-09 principal projector reconciles one finalized Vault/Gauge block and publishes bounded user pages', { timeout: 30_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_MIGRATION_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_ts09_project_${process.pid}_${randomBytes(4).toString('hex')}`; const schema = ident(schemaName);
  const handle = createDatabasePool(connectionString, { max: 2 });
  const bootstrap = f72BootstrapConfigs as unknown as Array<any>; const bootstrapLength = bootstrap.length;
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: F72_RELEASE_ID, activationBlock: 1n };
  const assetUid = hash('8'); const vault = fixedF72Sources().find((item) => item.module === 'UserStockVault')!.address as Address;
  bootstrap.push({ id: assetUid, kind: 'asset', status: 1, values: { stockToken: address('4'), tokenSymbol: 'TST', userStockVault: vault } });
  const user = address('1'); const marketId = hash('2'); const gauge = address('3'); const meme = address('4'); const quote = address('5');
  try {
    await applyCoreMigration(handle.pool, schemaName);
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES ('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest, hash('a'), hash('b'), hash('c')]);
    for (const [number, blockHash, parentHash] of [[1, hash('b'), hash('a')], [2, hash('c'), hash('b')]] as const) await handle.pool.query(
      `INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES ('test',46630,$1,$2,$3,$4,true,true,to_timestamp($5))`,
      [deployment.deploymentDigest, number, blockHash, parentHash, 1_000 + number]);
    await handle.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES ('test',46630,$1,'frontend-events',3,$2,0)`, [deployment.deploymentDigest, hash('c')]);
    await handle.pool.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES ('test',46630,$1,1,2,0,$2,true,now())`, [deployment.deploymentDigest, hash('d')]);
    await handle.pool.query(`INSERT INTO ${schema}.contract_sources(environment,chain_id,deployment_digest,module,address,birth_block,runtime_code_hash) VALUES ('test',46630,$1,'UserStockVault',$2,1,$3)`, [deployment.deploymentDigest, vault, fixedF72Sources().find((item) => item.module === 'UserStockVault')!.runtimeCodeHash]);
    await saveVaultLog(handle.pool, schema, deployment.deploymentDigest, 'StockDeposited', vault, 1, hash('b'), hash('6'), 0, { assetUid, user, amount: 100n });
    await saveVaultLog(handle.pool, schema, deployment.deploymentDigest, 'AllocationLocked', vault, 2, hash('c'), hash('7'), 0,
      { assetUid, user, marketId, amount: 40n, userMarketAllocation: 40n, userTotalAllocated: 40n });
    const revision = `2:${hash('c')}`;
    await handle.pool.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,2,$3,0,$4,'{}')`, [deployment.deploymentDigest, revision, hash('c'), hash('8')]);
    await handle.pool.query(`INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES ('test',46630,$1,'markets',$2,$3,$3,$4,$5)`,
      [deployment.deploymentDigest, revision, marketId, hash('9'), { marketId, assetUid, gauge, quoteAsset: quote, memeToken: meme, stakingEnabled: true }]);
    await handle.pool.query(`INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES ('test',46630,$1,'markets',$2)`, [deployment.deploymentDigest, revision]);

    const rpc = { callAt: async (target: Address, data: Hex): Promise<Hex> => {
      if (target === vault) {
        const decoded = decodeFunctionData({ abi: f72ReadAbis.UserStockVault as Abi, data });
        const result = decoded.functionName === 'deposited' ? 100n : decoded.functionName === 'allocated' || decoded.functionName === 'allocation' ? 40n : 60n;
        return encodeFunctionResult({ abi: f72ReadAbis.UserStockVault as Abi, functionName: decoded.functionName, result });
      }
      if (target === gauge) {
        const decoded = decodeFunctionData({ abi: f72ReadAbis.MemeStockGauge as Abi, data });
        if (decoded.functionName === 'positionOf') return encodeFunctionResult({ abi: f72ReadAbis.MemeStockGauge as Abi, functionName: 'positionOf',
          result: { activeAmount: 30n, pendingAmount: 10n, pendingGeneration: 7n, unlockAt: 1_100n, quoteClaimable: 5n, memeClaimable: 6n } });
        return encodeFunctionResult({ abi: f72ReadAbis.MemeStockGauge as Abi, functionName: 'activationSnapshot',
          result: { quoteAccumulator: 0n, memeAccumulator: 0n, refs: 1n, processed: false } });
      }
      return encodeFunctionResult({ abi: f72ReadAbis.AllocationManager as Abi, functionName: 'rageQuitSettlementPending', result: [false, 0n] });
    } };
    assert.deepEqual(await projectF72Principal({ pool: handle.pool, deployment, blockNumber: 2n, blockHash: hash('c'), generation: 0n,
      primary: rpc, secondary: rpc, schemaName }), { accounts: 1, positions: 1 });
    const app = createReadApiApp({ pool: handle.pool, deployment, env: { NODE_ENV: 'test', TG_ENVIRONMENT: 'test', TG_READ_DATABASE_URL: connectionString,
      TG_CURSOR_SECRET: 'integration-cursor-secret-at-least-32-bytes', TG_DATABASE_SCHEMA: schemaName } });
    const accountResponse = await app.request(`/v1/users/${user}/accounts?revision=${encodeURIComponent(revision)}`);
    assert.equal(accountResponse.status, 200);
    const accountPage = await accountResponse.json() as { items: Array<{ deposited: string; allocated: string; free: string }> };
    assert.deepEqual(accountPage.items.map((item) => ({ deposited: item.deposited, allocated: item.allocated, free: item.free })), [{ deposited: '100', allocated: '40', free: '60' }]);
    const positionResponse = await app.request(`/v1/users/${user}/positions?revision=${encodeURIComponent(revision)}`);
    assert.equal(positionResponse.status, 200);
    const positionPage = await positionResponse.json() as { items: Array<{ allocated: string; active: string; pending: string; activationAt: string }> };
    assert.deepEqual(positionPage.items.map((item) => ({ allocated: item.allocated, active: item.active, pending: item.pending, activationAt: item.activationAt })),
      [{ allocated: '40', active: '30', pending: '10', activationAt: '7' }]);
  } finally { bootstrap.length = bootstrapLength; await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end(); }
});

async function saveVaultLog(pool: ReturnType<typeof createDatabasePool>['pool'], schema: string, deploymentDigest: string, eventName: string,
  emitter: Address, blockNumber: number, blockHash: Hex, transactionHash: Hex, logIndex: number, args: Record<string, unknown>): Promise<void> {
  const abi = f72EventAbis.UserStockVault as Abi; const item = getAbiItem({ abi, name: eventName }) as AbiEvent;
  const topics = encodeEventTopics({ abi, eventName, args }); const inputs = item.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(inputs, inputs.map((input) => args[input.name!] as never));
  const payload = { address: emitter, blockNumber: String(blockNumber), blockHash, transactionHash, transactionIndex: '0', logIndex: String(logIndex), data, topics, removed: false };
  await pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) VALUES ('test',46630,$1,$2,$3,0,$4,$5,$6,$7)`, [deploymentDigest, blockHash, transactionHash, logIndex, emitter, topics[0], payload]);
}
