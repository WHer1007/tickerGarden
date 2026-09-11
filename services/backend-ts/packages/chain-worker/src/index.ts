import type { Pool } from 'pg';
import { transaction } from '../../db/src/index.ts';
import {
  consensusBlock, findCommonAncestor, ingestCanonicalRange, loadIngestionState, ReorgDetectedError, rewindCanonicalChain,
  RpcTransport, verifyChainIdentity, type DeploymentIdentity, type RpcBlock,
} from '../../chain/src/index.ts';
import { parseAlchemyBlockTrigger, type AlchemyWebhook } from '../../alchemy/src/index.ts';
import { discoverF72MarketSources, eventTopic, CURRENT_ACTIVATION_BLOCK, CURRENT_RELEASE_ID, fixedF72Sources } from '../../events/src/index.ts';
import { enqueueReliableMessage, type Lease } from '../../jobs/src/index.ts';
import { invalidateOrphanedPublications } from '../../projection/src/index.ts';
import { projectF72Markets } from '../../market-projector/src/index.ts';
import { projectF72Configs } from '../../config-projector/src/index.ts';
import { projectF72Analytics } from '../../analytics-projector/src/index.ts';
import { projectF72Principal } from '../../principal-projector/src/index.ts';
import { projectF72History } from '../../history-projector/src/index.ts';

const GENESIS_HASH = '0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32' as const;
const ACTIVATION_HASH = '0x36065fb09f78a00f75c528cad0e81e2f1a7b9f59bea9577488f26f4fb611f806' as const;
const ABI_DIGEST = '0xd80208c1ac00e7e2ab31fa7ce94bee6ed4159a802519b9d0fdbdf5a300a81b41' as const;
const STREAM = 'frontend-events';

export interface ChainProcessorOptions {
  readonly pool: Pool;
  readonly primary: RpcTransport;
  readonly secondary: RpcTransport;
  readonly environment?: DeploymentIdentity['environment'];
  readonly schemaName?: string;
  readonly finalityDelayBlocks?: bigint;
  readonly finalityDelaySeconds?: bigint;
  readonly initialBlock?: bigint;
  readonly latestOnFirstRequest?: boolean;
}

export function createChainProcessor(options: ChainProcessorOptions): (lease: Lease) => Promise<string> {
  const deployment: DeploymentIdentity = {
    environment: options.environment ?? 'test', chainId: 46630, deploymentDigest: CURRENT_RELEASE_ID, activationBlock: CURRENT_ACTIVATION_BLOCK,
  };
  return async (lease) => {
    await Promise.all([
      verifyChainIdentity(options.primary, 46630n, GENESIS_HASH),
      verifyChainIdentity(options.secondary, 46630n, GENESIS_HASH),
    ]);
    const head = await resolveHead(lease, options.primary, options.secondary);
    await ensureBootstrap({ ...options, deployment });
    const delayBlocks = options.finalityDelayBlocks ?? 2n;
    const delaySeconds = options.finalityDelaySeconds ?? 600n;
    const initialBlock = options.latestOnFirstRequest
      ? await latestFinalizedBlock(options.primary, options.secondary, deployment.activationBlock, head, delayBlocks, delaySeconds)
      : options.initialBlock;
    const state = await loadIngestionState({ pool: options.pool, deployment, stream: STREAM,
      ...(initialBlock !== undefined ? { initialNextBlock: initialBlock } : {}),
      ...(options.schemaName ? { schemaName: options.schemaName } : {}) });
    if (head.number < delayBlocks || state.nextBlock + delayBlocks > head.number) return `waiting:${state.nextBlock}`;

    const upperByBlocks = head.number - delayBlocks;
    let toBlock = state.nextBlock + 9n < upperByBlocks ? state.nextBlock + 9n : upperByBlocks;
    while (toBlock >= state.nextBlock) {
      const candidate = await consensusBlock(options.primary, options.secondary, toBlock);
      if (candidate.timestamp + delaySeconds <= head.timestamp) break;
      toBlock -= 1n;
    }
    if (toBlock < state.nextBlock) return `waiting:${state.nextBlock}`;

    let result;
    try {
      result = await ingestCanonicalRange({
        pool: options.pool, deployment, stream: STREAM, fromBlock: state.nextBlock, toBlock, observedHead: head,
        finalityDelayBlocks: delayBlocks, finalityDelaySeconds: delaySeconds, primary: options.primary, secondary: options.secondary,
        sources: state.sources.length ? state.sources : fixedF72Sources(),
        discover: (logs, block) => discoverF72MarketSources(logs, block.number, options.primary, options.secondary),
        ...(options.schemaName ? { schemaName: options.schemaName } : {}),
      });
    } catch (error) {
      if (!(error instanceof ReorgDetectedError) || state.nextBlock <= deployment.activationBlock) throw error;
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
    if (toBlock < upperByBlocks) await enqueueContinuation(options.pool, head, toBlock + 1n, BigInt(lease.generation), options.schemaName);
    else if (await projectionBatchPending(options.pool, deployment, toBlock, options.schemaName)) {
      const anchor = await consensusBlock(options.primary, options.secondary, toBlock);
      await projectF72Configs({
        pool: options.pool, deployment, blockNumber: anchor.number, blockHash: anchor.hash,
        generation: BigInt(result.generation), primary: options.primary, secondary: options.secondary,
        ...(options.schemaName ? { schemaName: options.schemaName } : {}),
      });
      await projectF72Markets({
        pool: options.pool, deployment, blockNumber: anchor.number, blockHash: anchor.hash, blockTimestamp: anchor.timestamp,
        generation: BigInt(result.generation), primary: options.primary, secondary: options.secondary,
        ...(options.schemaName ? { schemaName: options.schemaName } : {}),
      });
      await projectF72Principal({
        pool: options.pool, deployment, blockNumber: anchor.number, blockHash: anchor.hash,
        generation: BigInt(result.generation), primary: options.primary, secondary: options.secondary,
        ...(options.schemaName ? { schemaName: options.schemaName } : {}),
      });
      await projectF72History({
        pool: options.pool, deployment, blockNumber: anchor.number, blockHash: anchor.hash, generation: BigInt(result.generation),
        ...(options.schemaName ? { schemaName: options.schemaName } : {}),
      });
      await projectF72Analytics({
        pool: options.pool, deployment, blockNumber: anchor.number, blockHash: anchor.hash, generation: BigInt(result.generation),
        ...(options.schemaName ? { schemaName: options.schemaName } : {}),
      });
    }
    return JSON.stringify({ fromBlock: state.nextBlock.toString(), toBlock: toBlock.toString(), logs: result.logs, generation: result.generation });
  };
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
  return history.rows[0]?.pending === true;
}

async function resolveHead(lease: Lease, primary: RpcTransport, secondary: RpcTransport): Promise<RpcBlock> {
  let number: bigint;
  let expectedHash: string;
  if (lease.kind === 'alchemy-event-trigger' || lease.kind === 'alchemy-block-trigger') {
    const trigger = parseAlchemyBlockTrigger(lease.payload as AlchemyWebhook);
    number = trigger.number;
    expectedHash = trigger.hash;
  } else if (lease.kind === 'chain-backfill') {
    if (typeof lease.payload.headBlock !== 'string' || !/^[0-9]+$/.test(lease.payload.headBlock)
      || typeof lease.payload.headHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(lease.payload.headHash)) throw new Error('invalid backfill target');
    number = BigInt(lease.payload.headBlock);
    expectedHash = lease.payload.headHash;
  } else {
    throw new Error('unsupported chain job kind');
  }
  const head = await consensusBlock(primary, secondary, number);
  if (head.hash !== expectedHash) throw new Error('webhook or backfill head is no longer canonical');
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
