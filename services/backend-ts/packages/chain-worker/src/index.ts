import {CURRENT_CHAIN_ID,assertRuntimeEnvironment,runtimeGenesisHash,runtimeActivationHash} from '../../runtime-deployment/src/index.ts';
import { projectHolderRewards } from './holder-snapshots.ts';
import type { Pool } from 'pg';
import { transaction } from '../../db/src/index.ts';
import {
  consensusBlock, deserializeRpcLog, findCommonAncestor, ingestFinalizedSparseRange, loadIngestionState,
  ReorgDetectedError, rewindCanonicalChain, parseChainLogTrigger, RpcTransport, verifyChainIdentity,
  type DeploymentIdentity, type RpcBlock, type RpcLog,
} from '../../chain/src/index.ts';
import {
  decodeF72Event, discoverF72MarketSources, eventTopic, eventTopicsForModules,
  CURRENT_ACTIVATION_BLOCK, CURRENT_RELEASE_ID, fixedF72Sources,
} from '../../events/src/index.ts';
import { enqueueReliableMessage, type Lease } from '../../jobs/src/index.ts';
import { invalidateOrphanedPublications, ProjectionPending } from '../../projection/src/index.ts';
import { projectF72Markets } from '../../market-projector/src/index.ts';
import { projectF72Configs } from '../../config-projector/src/index.ts';
import { projectF72Analytics } from '../../analytics-projector/src/index.ts';
import { projectF72Principal } from '../../principal-projector/src/index.ts';
import { projectF72History } from '../../history-projector/src/index.ts';

const GENESIS_HASH = runtimeGenesisHash;
const ACTIVATION_HASH = runtimeActivationHash;
const ABI_DIGEST = '0x36125edf261162a5fb1db0547df88ea0737a12254e8f296302a7b32c7c51451c' as const;
const STREAM = 'frontend-events';

export interface ChainProcessorOptions {
  readonly pool: Pool;
  readonly primary: RpcTransport;
  readonly secondary: RpcTransport;
  readonly logsSecondary?: RpcTransport;
  readonly environment?: DeploymentIdentity['environment'];
  readonly schemaName?: string;
  readonly finalityDelayBlocks?: bigint;
  readonly finalityDelaySeconds?: bigint;
  readonly initialBlock?: bigint;
}

export function createChainProcessor(options: ChainProcessorOptions): (lease: Lease) => Promise<string> {
  assertRuntimeEnvironment({TG_ENVIRONMENT:options.environment??(CURRENT_CHAIN_ID===4663?'production':'test')});
  const deployment: DeploymentIdentity = {
    environment: options.environment ?? (CURRENT_CHAIN_ID===4663?'production':'test'), chainId: CURRENT_CHAIN_ID, deploymentDigest: CURRENT_RELEASE_ID, activationBlock: CURRENT_ACTIVATION_BLOCK,
  };
  return async (lease) => {
    await Promise.all([
      verifyChainIdentity(options.primary, BigInt(CURRENT_CHAIN_ID), GENESIS_HASH),
      verifyChainIdentity(options.secondary, BigInt(CURRENT_CHAIN_ID), GENESIS_HASH),
    ]);
    const head = await resolveHead(lease, options.primary, options.secondary, deployment);
    await ensureBootstrap({ ...options, deployment });
    const delayBlocks = options.finalityDelayBlocks ?? 2n;
    const delaySeconds = options.finalityDelaySeconds ?? 600n;
    const initialBlock = options.initialBlock ?? deployment.activationBlock;
    const state = await loadIngestionState({ pool: options.pool, deployment, stream: STREAM,
      ...(initialBlock !== undefined ? { initialNextBlock: initialBlock } : {}),
      ...(options.schemaName ? { schemaName: options.schemaName } : {}) });
    // Continuations must detect rewinds too: they can run before ingestion.
    if (state.nextBlock > deployment.activationBlock) {
      const priorAnchor = await options.pool.query<{hash:string}>(`SELECT hash FROM ${identifier(options.schemaName??'tickergarden_serverless')}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND canonical`,[deployment.environment,deployment.chainId,deployment.deploymentDigest,(state.nextBlock-1n).toString()]);
      if (priorAnchor.rows[0] && (await consensusBlock(options.primary,options.secondary,state.nextBlock-1n)).hash!==priorAnchor.rows[0].hash) return recoverReorg();
    }
    // Finish the oldest durable candidate before observing a later head. This
    // prevents a busy chain from starving a multi-job bootstrap indefinitely.
    const projectionSchema=identifier(options.schemaName??'tickergarden_serverless');
    const candidate=(await options.pool.query<{block_number:string}>(`SELECT min(o.block_number)::text block_number FROM (SELECT environment,chain_id,deployment_digest,generation,block_number,block_hash FROM ${projectionSchema}.projection_observations UNION SELECT environment,chain_id,deployment_digest,generation,block_number,block_hash FROM ${projectionSchema}.principal_candidates WHERE phase<>'published') o
      JOIN ${projectionSchema}.chain_blocks b ON b.environment=o.environment AND b.chain_id=o.chain_id AND b.deployment_digest=o.deployment_digest AND b.hash=o.block_hash
      WHERE o.environment=$1 AND o.chain_id=$2 AND o.deployment_digest=$3 AND o.generation=$4 AND b.canonical AND b.finalized
      AND o.block_number>=coalesce((SELECT next_block FROM ${projectionSchema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='holder-rewards' AND generation=$4),$5)`,[deployment.environment,deployment.chainId,deployment.deploymentDigest,state.generation.toString(),deployment.activationBlock.toString()])).rows[0];
    if(candidate?.block_number){await runProjection(BigInt(candidate.block_number),state.generation);return `projection:${candidate.block_number}`;}
    if(lease.kind==='projection-continuation')return 'projection:already-complete-or-obsolete';
    if (head.number < delayBlocks) return `waiting:${state.nextBlock}`;

    const finalizedUpper = await latestFinalizedBlock(options.primary, options.secondary, deployment.activationBlock,
      head, delayBlocks, delaySeconds);
    if (state.nextBlock > finalizedUpper) {
      const anchorNumber = state.nextBlock - 1n;
      if (await projectionBatchPending(options.pool, deployment, anchorNumber, options.schemaName)) {
        await runProjection(anchorNumber, state.generation);
        return `projected:${anchorNumber}`;
      }
      return `waiting:${state.nextBlock}`;
    }
    const sparse = finalizedUpper - state.nextBlock >= 10n;
    const toBlock = sparse
      ? (state.nextBlock + 49_999n < finalizedUpper ? state.nextBlock + 49_999n : finalizedUpper)
      : (state.nextBlock + 9n < finalizedUpper ? state.nextBlock + 9n : finalizedUpper);

    let result;
    try {
      const common = {
        pool: options.pool, deployment, stream: STREAM, fromBlock: state.nextBlock, toBlock, observedHead: head,
        finalityDelayBlocks: delayBlocks, finalityDelaySeconds: delaySeconds, primary: options.primary, secondary: options.secondary,
        sources: state.sources.length ? state.sources : fixedF72Sources(),
        discover: (logs: readonly RpcLog[], block: RpcBlock) => discoverF72MarketSources(logs, block.number, options.primary, options.secondary),
        ...(options.schemaName ? { schemaName: options.schemaName } : {}),
      } as const;
      // Shared PoolManager logs must be scoped to protocol-owned pools even for short ranges.
      {
        const poolManager = fixedF72Sources().find((source) => source.module === 'UniswapV4PoolManager')!;
        const protocolSources = common.sources.filter((source) => source.address !== poolManager.address);
        const eventTopics = eventTopicsForModules([...new Set([...protocolSources.map((source) => source.module), 'TickerMemeTokenV1', 'TickerGardenCurve'])]);
        result = await ingestFinalizedSparseRange({ ...common, secondary: options.logsSecondary ?? options.secondary, sources: protocolSources, eventTopics,
          excludedAddresses: [poolManager.address],
          additionalQueries: async (currentLogs) => poolManagerQueries(options.pool, deployment, common.sources, currentLogs, poolManager.address, options.schemaName),
        });
      }
    } catch (error) {
      if (!(error instanceof ReorgDetectedError) || state.nextBlock <= deployment.activationBlock) throw error;
      return recoverReorg();
    }
    if (toBlock < finalizedUpper) await enqueueContinuation(options.pool, head, toBlock + 1n, BigInt(lease.generation), options.schemaName);
    else await runProjection(toBlock, BigInt(result.generation));
    return JSON.stringify({ fromBlock: state.nextBlock.toString(), toBlock: toBlock.toString(), logs: result.logs, generation: result.generation });
    async function recoverReorg():Promise<string>{
      const maximumDepth = state.nextBlock - 1n - deployment.activationBlock < 1_000n
        ? state.nextBlock - 1n - deployment.activationBlock : 1_000n;
      const ancestor = await findCommonAncestor({
        pool: options.pool, deployment, primary: options.primary, secondary: options.secondary,
        fromBlock: state.nextBlock - 1n, maxDepth: maximumDepth,
        ...(options.schemaName ? { schemaName: options.schemaName } : {}),
      });
      const generation = BigInt(await rewindCanonicalChain({
        pool: options.pool, deployment, stream: STREAM, ancestor, expectedNextBlock: state.nextBlock,
        ...(options.schemaName ? { schemaName: options.schemaName } : {}),
      }));
      await invalidateOrphanedPublications({ pool: options.pool, deployment, generation, ...(options.schemaName ? { schemaName: options.schemaName } : {}) });
      await enqueueContinuation(options.pool, head, ancestor.number + 1n, BigInt(lease.generation), options.schemaName);
      return JSON.stringify({ reorg: true, ancestor: ancestor.number.toString(), generation: generation.toString() });
    }
    async function runProjection(block:bigint,generation:bigint):Promise<void>{
      try { await projectBatch(options,deployment,block,generation); }
      catch(error){
        if(!(error instanceof ProjectionPending))throw error;
        const payload={headBlock:head.number.toString(),headHash:head.hash,projectionBlock:block.toString(),ingestionGeneration:generation.toString()};
        const key=`projection:${generation}:${block}:${head.hash}:${error.scope}:${error.completed}`;
        await enqueueReliableMessage(options.pool,{queue:'chain',externalId:key,operationId:key,kind:'projection-continuation',rawBody:JSON.stringify(payload),payload,destinationKey:'chain-worker',maxAttempts:16,generation:BigInt(lease.generation)},options.schemaName);
      }
    }
  };
}

async function projectBatch(options: ChainProcessorOptions, deployment: DeploymentIdentity, blockNumber: bigint, generation: bigint): Promise<void> {
  const anchor = await consensusBlock(options.primary, options.secondary, blockNumber);
  const schema = options.schemaName ? { schemaName: options.schemaName } : {};
  const completed=(await options.pool.query<{scope:string;next_block:string;generation:string}>(`SELECT scope,next_block,generation FROM ${identifier(options.schemaName??'tickergarden_serverless')}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[deployment.environment,deployment.chainId,deployment.deploymentDigest])).rows;
  const done=(scope:string)=>completed.some(row=>row.scope===scope&&BigInt(row.generation)===generation&&BigInt(row.next_block)>blockNumber);

  if(!(done('configs')))await projectF72Configs({ pool: options.pool, deployment, blockNumber, blockHash: anchor.hash, generation,
    primary: options.primary, secondary: options.secondary, ...schema });
  if(!(done('markets')))await projectF72Markets({ pool: options.pool, deployment, blockNumber, blockHash: anchor.hash, blockTimestamp: anchor.timestamp,
    generation, primary: options.primary, secondary: options.secondary, ...schema });
  if(!(done('accounts')&&done('positions')))await projectF72Principal({ pool: options.pool, deployment, blockNumber, blockHash: anchor.hash, generation,
    primary: options.primary, secondary: options.secondary, ...schema });
  if(!(done('history')))await projectF72History({ pool: options.pool, deployment, blockNumber, blockHash: anchor.hash, generation, ...schema });
  if(!(done('analytics')))await projectF72Analytics({ pool: options.pool, deployment, blockNumber, blockHash: anchor.hash, generation, ...schema });
  if(!(done('holder-rewards')))await projectHolderRewards({pool:options.pool,deployment,blockNumber,blockHash:anchor.hash,generation,primary:options.primary,secondary:options.secondary,...schema});
  await options.pool.query(`DELETE FROM ${identifier(options.schemaName??'tickergarden_serverless')}.projection_observations WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND (generation<$4 OR (generation=$4 AND block_number<=$5))`,[deployment.environment,deployment.chainId,deployment.deploymentDigest,generation.toString(),blockNumber.toString()]);
  for(const table of ['market_observation_work','market_work_candidates','holder_market_work','holder_work_candidates','holder_work_events'])await options.pool.query(`DELETE FROM ${identifier(options.schemaName??'tickergarden_serverless')}.${table} w USING ${identifier(options.schemaName??'tickergarden_serverless')}.chain_blocks b WHERE w.environment=$1 AND w.chain_id=$2 AND w.deployment_digest=$3 AND w.generation<=$4 AND b.environment=w.environment AND b.chain_id=w.chain_id AND b.deployment_digest=w.deployment_digest AND b.hash=w.block_hash AND (w.generation<$4 OR b.number<=$5)`,[deployment.environment,deployment.chainId,deployment.deploymentDigest,generation.toString(),blockNumber.toString()]);
  await options.pool.query(`DELETE FROM ${identifier(options.schemaName??'tickergarden_serverless')}.market_time_refresh WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation<$4`,[deployment.environment,deployment.chainId,deployment.deploymentDigest,generation.toString()]);
}

async function poolManagerQueries(pool: Pool, deployment: DeploymentIdentity, sources: readonly { module: string; address: `0x${string}` }[],
  currentLogs: readonly RpcLog[], poolManager: `0x${string}`, schemaName?: string) {
  const schema = identifier(schemaName ?? 'tickergarden_serverless');
  const stored = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT l.payload FROM ${schema}.chain_logs l WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.canonical AND l.topic0=ANY($4::text[])`,
    [deployment.environment, deployment.chainId, deployment.deploymentDigest, [eventTopic('MarketRegistryV1','LaunchPhaseChanged'),eventTopic('TickerGardenMemeHook','ExpectedPoolRegistered'),eventTopic('TickerGardenMemeHook','PoolBindingActivated')]],
  );
  const sourceByAddress = new Map(sources.map((source) => [source.address, source.module]));
  const poolIds = new Set<`0x${string}`>();
  for (const log of [...stored.rows.map((row) => deserializeRpcLog(row.payload)), ...currentLogs]) {
    const module = sourceByAddress.get(log.address);
    if (!module) continue;
    try {
      const decoded = decodeF72Event(module as Parameters<typeof decodeF72Event>[0], log);
      const poolId = decoded?.args.poolId;
      if (typeof poolId === 'string' && /^0x[0-9a-f]{64}$/.test(poolId) && !/^0x0{64}$/.test(poolId)) poolIds.add(poolId as `0x${string}`);
    } catch { /* unrelated frozen modules do not contribute pool IDs */ }
  }
  return poolIds.size ? [{ addresses: [poolManager], topics: [eventTopic('UniswapV4PoolManager', 'Swap'), [...poolIds].sort()] }] : [];
}

const MARKET_PROJECTION_TOPICS = [
  eventTopic('TickerGardenFactoryV1', 'MarketCreated'), eventTopic('MarketRegistryV1', 'LaunchPhaseChanged'),
  eventTopic('TickerGardenCurve', 'CurveBuy'), eventTopic('TickerGardenCurve', 'CurveSell'), eventTopic('TickerGardenCurve', 'CurveCompleted'),
  eventTopic('UniswapV4PoolManager', 'Swap'), eventTopic('TickerGardenMemeHook', 'V4FeeAccrued'),
  eventTopic('ProtocolFeeVault', 'RewardBatchConverted'), eventTopic('ProtocolFeeVault', 'HolderRewardsConverted'),
  eventTopic('ProtocolFeeVault', 'CurveFeesSwept'), eventTopic('ProtocolFeeVault', 'FeeBucketsCredited'),
  eventTopic('ProtocolFeeVault', 'HolderFeesAccrued'),
  eventTopic('TickerMemeTokenV1', 'Transfer'),
];

async function projectionBatchPending(pool: Pool, deployment: DeploymentIdentity, throughBlock: bigint, schemaName?: string): Promise<boolean> {
  const schema = identifier(schemaName ?? 'tickergarden_serverless');
  const result = await pool.query<{ pending: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM ${schema}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets'
     ) OR EXISTS (
       SELECT 1 FROM ${schema}.chain_logs l
       JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
       WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.canonical AND b.canonical AND b.finalized
         AND l.topic0=ANY($4::text[]) AND b.number<= $5
         AND b.number > COALESCE((SELECT p.block_number FROM ${schema}.publication_pointers pointer
           JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
           WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND pointer.scope='markets'),-1)
     ) AS pending`,
    [deployment.environment, deployment.chainId, deployment.deploymentDigest, MARKET_PROJECTION_TOPICS, throughBlock.toString()],
  );
  if (result.rows[0]?.pending === true) return true;
  const configAddresses = ['OfficialStockRegistryV1', 'ApprovedQuoteRegistry', 'TickerGardenBaselineRegistry', 'LaunchTemplateRegistry']
    .map((module) => fixedF72Sources().find((source) => source.module === module)!.address);
  const configs = await pool.query<{ pending: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM ${schema}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='configs'
     ) OR EXISTS (
       SELECT 1 FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b
         ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
       WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.address=ANY($4::text[])
         AND l.canonical AND b.canonical AND b.finalized AND b.number<=$5
         AND b.number > COALESCE((SELECT p.block_number FROM ${schema}.publication_pointers pointer
           JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
           WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND pointer.scope='configs'),-1)
     ) AS pending`,
    [deployment.environment, deployment.chainId, deployment.deploymentDigest, configAddresses, throughBlock.toString()],
  );
  if (configs.rows[0]?.pending === true) return true;
  const principal = await pool.query<{ pending: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM ${schema}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='accounts'
     ) OR NOT EXISTS (
       SELECT 1 FROM ${schema}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='positions'
     ) OR EXISTS (
       SELECT 1 FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b
         ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
       JOIN ${schema}.contract_sources s ON s.environment=l.environment AND s.chain_id=l.chain_id AND s.deployment_digest=l.deployment_digest AND s.address=l.address
       WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.canonical AND b.canonical AND b.finalized
         AND s.module=ANY($4::text[]) AND b.number<=$5
         AND b.number > COALESCE((SELECT p.block_number FROM ${schema}.publication_pointers pointer
           JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
           WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND pointer.scope='positions'),-1)
     ) AS pending`,
    [deployment.environment, deployment.chainId, deployment.deploymentDigest,
      ['UserStockVault', 'MemeStockGauge', 'AllocationManager', 'ProtocolFeeVault'], throughBlock.toString()],
  );
  if (principal.rows[0]?.pending === true) return true;
  const history = await pool.query<{ pending: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='history'
     ) OR EXISTS (
       SELECT 1 FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b
         ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
       WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.canonical AND b.canonical AND b.finalized AND b.number<=$4
         AND b.number >= COALESCE((SELECT next_block FROM ${schema}.projection_checkpoints
           WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='history'),$5)
     ) AS pending`,
    [deployment.environment, deployment.chainId, deployment.deploymentDigest, throughBlock.toString(), deployment.activationBlock.toString()],
  );
  if(history.rows[0]?.pending === true)return true;
  const holder=await pool.query(`SELECT 1 FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='holder-rewards' AND next_block>$4`,[deployment.environment,deployment.chainId,deployment.deploymentDigest,throughBlock.toString()]);
  return holder.rowCount===0;
}

async function resolveHead(lease: Lease, primary: RpcTransport, secondary: RpcTransport, deployment: DeploymentIdentity): Promise<RpcBlock> {
  let number: bigint;
  let expectedHash: string;
  if (lease.kind === 'chain-log-trigger') {
    const trigger = parseChainLogTrigger(lease.payload, deployment);
    number = trigger.number;
    expectedHash = trigger.hash;
  } else if (lease.kind === 'chain-backfill' || lease.kind === 'projection-continuation') {
    if (typeof lease.payload.headBlock !== 'string' || !/^[0-9]+$/.test(lease.payload.headBlock)
      || typeof lease.payload.headHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(lease.payload.headHash)) throw new Error('invalid backfill target');
    number = BigInt(lease.payload.headBlock);
    expectedHash = lease.payload.headHash;
  } else {
    throw new Error('unsupported chain job kind');
  }
  const head = await consensusBlock(primary, secondary, number);
  if (head.hash !== expectedHash && lease.kind !== 'projection-continuation') throw new Error('webhook or backfill head is no longer canonical');
  return head;
}

async function ensureBootstrap(options: ChainProcessorOptions & { readonly deployment: DeploymentIdentity }): Promise<void> {
  const schema = identifier(options.schemaName ?? 'tickergarden_serverless');
  const existing = await options.pool.query(
    `SELECT 1 FROM ${schema}.deployments WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,
    [options.deployment.environment, options.deployment.chainId, options.deployment.deploymentDigest],
  );
  if (existing.rowCount) return;
  const activation = await consensusBlock(options.primary, options.secondary, CURRENT_ACTIVATION_BLOCK);
  if (activation.hash !== ACTIVATION_HASH) throw new Error('deployment activation hash mismatch');
  const sources = fixedF72Sources();
  await Promise.all(sources.map(async (source) => {
    const [first, second] = await Promise.all([
      options.primary.codeHash(source.address, source.birthBlock), options.secondary.codeHash(source.address, source.birthBlock),
    ]);
    if (first !== source.runtimeCodeHash || second !== source.runtimeCodeHash) throw new Error(`runtime code identity mismatch for ${source.module}`);
  }));
  await transaction(options.pool, async (client) => {
    await client.query(
      `INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [options.deployment.environment, options.deployment.chainId, options.deployment.deploymentDigest, GENESIS_HASH, CURRENT_ACTIVATION_BLOCK.toString(), ACTIVATION_HASH, ABI_DIGEST],
    );
    for (const source of sources) {
      await client.query(
        `INSERT INTO ${schema}.contract_sources(environment,chain_id,deployment_digest,module,address,birth_block,runtime_code_hash,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT DO NOTHING`,
        [options.deployment.environment, options.deployment.chainId, options.deployment.deploymentDigest, source.module, source.address, source.birthBlock.toString(), source.runtimeCodeHash],
      );
    }
  });
}

async function latestFinalizedBlock(primary: RpcTransport, secondary: RpcTransport, activationBlock: bigint, head: RpcBlock,
  delayBlocks: bigint, delaySeconds: bigint): Promise<bigint> {
  if (head.number <= activationBlock + delayBlocks) return activationBlock;
  const upper = head.number - delayBlocks;
  const cutoff = head.timestamp > delaySeconds ? head.timestamp - delaySeconds : 0n;
  let low = activationBlock;
  let high = upper;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    const block = await consensusBlock(primary, secondary, middle);
    if (block.timestamp <= cutoff) low = middle;
    else high = middle - 1n;
  }
  return low;
}

async function enqueueContinuation(pool: Pool, head: RpcBlock, fromBlock: bigint, generation: bigint, schemaName?: string): Promise<void> {
  const suffix = `g${generation}-${fromBlock}-${head.number}-${head.hash.slice(2, 14)}`;
  const payload = { headBlock: head.number.toString(), headHash: head.hash, fromBlock: fromBlock.toString() } as const;
  const rawBody = JSON.stringify(payload);
  await enqueueReliableMessage(pool, {
    queue: 'chain', externalId: `backfill-${suffix}`, operationId: `backfill:${suffix}`, kind: 'chain-backfill',
    rawBody, payload, destinationKey: 'chain-worker', maxAttempts: 16, generation,
  }, schemaName);
}

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name');
  return `"${value}"`;
}
