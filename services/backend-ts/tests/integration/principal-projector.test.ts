import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAbiItem, type Abi, type AbiEvent, type Address, type Hex } from 'viem';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { f72EventAbis, f72ReadAbis } from '../../packages/events/src/f72-abis.generated.ts';
import { F72_RELEASE_ID, fixedF72Sources } from '../../packages/events/src/index.ts';
import { ProjectionPending } from '../../packages/projection/src/index.ts';
import { projectF72Principal } from '../../packages/principal-projector/src/index.ts';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import { f72BootstrapConfigs } from '../../packages/config-projector/src/f72-bootstrap.generated.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (character: string): Hex => `0x${character.repeat(64)}`;
const address = (character: string): Address => `0x${character.repeat(40)}`;
const ident = (value: string): string => { assert.match(value, /^[a-z][a-z0-9_]{0,62}$/); return `"${value}"`; };

test('TS-09 principal projector reconciles one finalized Vault/Gauge block and publishes bounded user pages', { timeout: 180_000 }, async (context) => {
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
    // Durable event pages publish neither scope until all verification is complete.
    let calls = 0;
    const counted = {callAt: async (target:Address,data:Hex) => {calls++; return rpc.callAt(target,data);}};
    await projectF72Principal({pool:handle.pool,deployment,blockNumber:2n,blockHash:hash('c'),generation:0n,primary:counted,secondary:counted,schemaName});
    assert.equal(calls,0,'published retry performs no RPC');
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
    async function advance(n:number,blockHash:Hex,parent:Hex){
      await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES('test',46630,$1,$2,$3,$4,true,true,to_timestamp($5))`,[deployment.deploymentDigest,n,blockHash,parent,1000+n]);
      await handle.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET next_block=$1,last_block_hash=$2`,[n+1,blockHash]);
      await handle.pool.query(`UPDATE ${schema}.covered_ranges SET to_block=$1`,[n]);
      const nextRevision=`${n}:${blockHash}`;
      await handle.pool.query(`INSERT INTO ${schema}.publications SELECT environment,chain_id,deployment_digest,scope,$1,$2,$3,generation,payload_digest,payload,now() FROM ${schema}.publications WHERE scope='markets' AND revision=$4`,[nextRevision,n,blockHash,revision]);
      await handle.pool.query(`INSERT INTO ${schema}.projection_records SELECT environment,chain_id,deployment_digest,scope,$1,identity,sort_key,payload_digest,payload FROM ${schema}.projection_records WHERE scope='markets' AND revision=$2`,[nextRevision,revision]);
      await handle.pool.query(`UPDATE ${schema}.publication_pointers SET revision=$1 WHERE scope='markets'`,[nextRevision]);
    }
    await advance(3,hash('d'),hash('c'));
    calls=0;
    const next={pool:handle.pool,deployment,blockNumber:3n,blockHash:hash('d'),generation:0n,primary:counted,secondary:counted,schemaName,maxPages:1,pageSize:1};
    let continuations=0;
    while(true){try{await projectF72Principal(next);break;}catch(e){if(!(e instanceof ProjectionPending))throw e;continuations++;assert.ok(continuations<12);const pointers=(await handle.pool.query(`SELECT DISTINCT revision FROM ${schema}.publication_pointers WHERE scope IN ('accounts','positions')`)).rows;assert.deepEqual(pointers,[{revision}]);}}
    assert.ok(continuations>=3);
    assert.equal(calls,8,'quiet block checks only the pending position, not the account');
    assert.equal((await handle.pool.query(`SELECT count(*)::int n FROM ${schema}.principal_record_versions WHERE scope='accounts'`)).rows[0].n,1,'unchanged account version reused');
    await advance(4,hash('e'),hash('d'));
    await saveVaultLog(handle.pool,schema,deployment.deploymentDigest,'StockWithdrawn',vault,4,hash('e'),hash('f'),0,{assetUid,user,amount:10n});
    const changed={callAt:async(target:Address,data:Hex)=>{if(target===vault){const d=decodeFunctionData({abi:f72ReadAbis.UserStockVault as Abi,data});if(d.functionName==='deposited'||d.functionName==='freeBalanceOf')return encodeFunctionResult({abi:f72ReadAbis.UserStockVault as Abi,functionName:d.functionName,result:d.functionName==='deposited'?90n:50n});}return rpc.callAt(target,data);}};
    const fourth={...next,blockNumber:4n,blockHash:hash('e'),maxPages:20,primary:changed,secondary:rpc};
    await assert.rejects(projectF72Principal(fourth),/RPC providers disagree/);
    assert.deepEqual((await handle.pool.query(`SELECT DISTINCT revision FROM ${schema}.publication_pointers WHERE scope IN ('accounts','positions')`)).rows,[{revision:`3:${hash('d')}`}]);
    await projectF72Principal({...fourth,secondary:changed});
    const latest=(await handle.pool.query(`SELECT payload FROM ${schema}.projection_read_records WHERE scope='positions' AND revision=$1`,[`4:${hash('e')}`])).rows[0].payload;
    assert.equal(latest.free,'50');assert.equal(latest.allocated,'40');
    const historical=(await handle.pool.query(`SELECT payload FROM ${schema}.projection_read_records WHERE scope='positions' AND revision=$1`,[revision])).rows[0].payload;
    assert.equal(historical.free,'60','historical immutable revision retained');
    if(process.env.TG_TEST_PRINCIPAL_CAPACITY==='1'){
      // More than the former hard cap in BOTH ledger populations; synthetic RPC
      // isolates pagination/continuation correctness from network rate limits.
      for(const kind of ['accounts','positions'])await handle.pool.query(`INSERT INTO ${schema}.principal_ledger SELECT environment,chain_id,deployment_digest,generation,kind,('0x'||lpad(to_hex(n),40,'0'))||':'||asset_uid||CASE WHEN kind='positions' THEN ':'||market_id ELSE '' END,('0x'||lpad(to_hex(n),40,'0')),asset_uid,market_id,payload||jsonb_build_object('user','0x'||lpad(to_hex(n),40,'0'))||CASE WHEN kind='accounts' THEN '{"deposited":"1","allocated":"1"}'::jsonb ELSE '{"amount":"1"}'::jsonb END FROM ${schema}.principal_ledger CROSS JOIN generate_series(1,10001) n WHERE kind=$1 AND user_address=$2`,[kind,user]);
      await advance(5,hash('f'),hash('e'));
      const capacityRpc={callAt:async(target:Address,data:Hex)=>{
        const abi=target===vault?f72ReadAbis.UserStockVault:target===gauge?f72ReadAbis.MemeStockGauge:f72ReadAbis.AllocationManager;
        const decoded=decodeFunctionData({abi:abi as Abi,data});
        if(decoded.args?.some(a=>a===user)||decoded.functionName==='activationSnapshot')return changed.callAt(target,data);
        const result=target===vault?(decoded.functionName==='freeBalanceOf'?0n:1n):target===gauge?{activeAmount:1n,pendingAmount:0n,pendingGeneration:0n,unlockAt:1100n,quoteClaimable:0n,memeClaimable:0n}:[false,0n];
        return encodeFunctionResult({abi:abi as Abi,functionName:decoded.functionName,result});
      }};
      const result=await projectF72Principal({...fourth,blockNumber:5n,blockHash:hash('f'),primary:capacityRpc,secondary:capacityRpc,pageSize:250,maxPages:1000,budgetMs:180000,fullAuditIntervalBlocks:1n});
      assert.equal(result.accounts,10002);assert.equal(result.positions,10002);
      assert.equal((await handle.pool.query(`SELECT count(*)::int n FROM ${schema}.principal_work WHERE block_hash=$1`,[hash('f')])).rows[0].n,0,'completed transient work is reclaimed');
      assert.deepEqual((await handle.pool.query(`SELECT (payload->>'verifiedRecordCount')::int n FROM ${schema}.publications WHERE revision=$1 AND scope IN ('accounts','positions') ORDER BY scope`,[`5:${hash('f')}`])).rows,[{n:10002},{n:10002}]);
    }
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
