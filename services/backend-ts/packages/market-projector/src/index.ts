import type {MarketReadModel} from '../../../openapi/generated/v1-client.ts';
import { transaction } from '../../db/src/index.ts';
import { decodeMarketRecord } from "../../chain/src/market-record.ts";
import { decodeCoreMarketRoute } from '../../chain/src/market-route.ts';
import { externalTradingService } from '../../chain/src/external-trading.ts';
import type { Pool } from 'pg';
import {
  decodeFunctionResult, encodeFunctionData, encodeAbiParameters, formatUnits, parseAbi, keccak256, type Abi, type Address, type Hex,
} from 'viem';
import type { DeploymentIdentity, RpcLog, RpcTransport } from '../../chain/src/index.ts';
import { decodeF72Event, eventTopic, fixedF72Sources, f72EventCatalog, f72ReadAbis } from '../../events/src/index.ts';
import { consensusBlock } from '../../chain/src/index.ts';
import { publishProjection, publishMarketDelta, acknowledgeMarketPublication, ProjectionPending, type Json, type ProjectionRecord } from '../../projection/src/index.ts';

const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as Address;
const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex;
const REGISTRY = f72EventCatalog.MarketRegistryV1.address;
const FACTORY = f72EventCatalog.TickerGardenFactoryV1.address;
const MARKET_CREATED_TOPIC = eventTopic('TickerGardenFactoryV1', 'MarketCreated');
const EXECUTION_SPEC_ID = keccak256(new TextEncoder().encode('V1-EXEC-11'));

type SourceBlock = {
  readonly chainId: 4663 | 46630; readonly blockNumber: string; readonly blockHash: Hex;
  readonly transactionHash: Hex; readonly transactionIndex: number; readonly logIndex: number;
};

export interface MarketCreation {
  readonly marketId: Hex;
  readonly assetUid: Hex;
  readonly memeToken: Address;
  readonly curve: Address;
  readonly gauge: Address;
  readonly quoteAsset: Address;
  readonly quoteAssetConfigId: Hex;
  readonly tickerGardenBaselineId: Hex;
  readonly expectedEconomics: Hex;
  readonly source: SourceBlock;
}

export interface ObserveF72MarketInput {
  readonly previous?: MarketReadModel;
  readonly creation: MarketCreation;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly blockTimestamp: bigint;
  readonly primary: RpcTransport;
  readonly secondary: RpcTransport;
}

export async function loadF72MarketCreations(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly throughBlock: bigint; readonly schemaName?: string; readonly marketIds?: readonly string[];
}): Promise<MarketCreation[]> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const rows = await input.pool.query<{ payload: Record<string, unknown> }>(
    `SELECT l.payload FROM ${schema}.chain_logs l
     JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
     WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.address=$4 AND l.topic0=$5
       AND l.canonical AND b.canonical AND b.finalized AND b.number<=$6
       AND NOT EXISTS(SELECT 1 FROM ${schema}.market_creation_directory d WHERE d.environment=l.environment AND d.chain_id=l.chain_id AND d.deployment_digest=l.deployment_digest AND d.block_hash=l.block_hash AND d.transaction_hash=l.transaction_hash AND d.log_index=l.log_index)
     ORDER BY b.number,l.transaction_index,l.log_index`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, FACTORY, MARKET_CREATED_TOPIC, input.throughBlock.toString()],
  );
  const creations = new Map<string, MarketCreation>();
  for (const row of rows.rows) {
    const log = parseStoredLog(row.payload);
    const decoded = decodeF72Event('TickerGardenFactoryV1', log);
    if (!decoded || decoded.eventName !== 'MarketCreated') throw new Error('stored MarketCreated log cannot be decoded with frozen f72 ABI');
    const creation = creationFromEvent(decoded.args, log, input.deployment.chainId);
    if (creations.has(creation.marketId)) throw new Error('duplicate canonical MarketCreated identity');
    creations.set(creation.marketId, creation);
  }
  const values=[...creations.values()];
  for(let offset=0;offset<values.length;offset+=250)await input.pool.query(`INSERT INTO ${schema}.market_creation_directory(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index,market_id,payload) SELECT $1,$2,$3,r.payload->'source'->>'blockHash',r.payload->'source'->>'transactionHash',(r.payload->'source'->>'logIndex')::bigint,r.payload->>'marketId',r.payload FROM jsonb_to_recordset($4::jsonb) r(payload jsonb) ON CONFLICT DO NOTHING`,[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,JSON.stringify(values.slice(offset,offset+250).map(payload=>({payload})))]);
  const saved=(await input.pool.query<{payload:MarketCreation}>(`SELECT d.payload FROM ${schema}.market_creation_directory d JOIN ${schema}.chain_blocks b ON b.environment=d.environment AND b.chain_id=d.chain_id AND b.deployment_digest=d.deployment_digest AND b.hash=d.block_hash WHERE d.environment=$1 AND d.chain_id=$2 AND d.deployment_digest=$3 AND b.canonical AND b.finalized AND b.number<=$4 AND ($5::text[] IS NULL OR d.market_id=ANY($5::text[])) ORDER BY b.number,d.log_index`,[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,input.throughBlock.toString(),input.marketIds??null])).rows.map(r=>r.payload);
  if(new Set(saved.map(r=>r.marketId)).size!==saved.length)throw Error('duplicate canonical MarketCreated identity');
  return saved;
}

export async function observeF72Market(input: ObserveF72MarketInput): Promise<Json> {
  const market = objectResult(await readFunction(input, REGISTRY, f72ReadAbis.MarketRegistryV1 as Abi, 'market', [input.creation.marketId]));
  const config = objectResult(market.config);
  const runtime = objectResult(market.runtime);
  assertCreationMatches(input.creation, config);
  const sourceVersion = safeNumber(runtime.sourceVersion, 32, 'sourceVersion');
  const launchPhase = safeNumber(runtime.launchPhase, 8, 'launchPhase');
  const poolId = hex32(runtime.poolId, 'poolId');
  if ((launchPhase === 0 && (sourceVersion !== 1 || poolId !== ZERO_HASH))
    || (launchPhase === 1 && (sourceVersion !== 2 || poolId === ZERO_HASH))) throw new Error('invalid market runtime transition');

  const memeToken = address(config.memeToken, 'memeToken');
  const curve = address(config.curve, 'curve');
  const gauge = address(config.gauge, 'gauge');
  const quoteAsset = address(config.quoteAsset, 'quoteAsset');
  const reverse = hex32(await readFunction(input, REGISTRY, f72ReadAbis.MarketRegistryV1 as Abi, 'marketIdByToken', [memeToken]), 'market reverse identity');
  if (reverse !== input.creation.marketId) throw new Error('market reverse identity mismatch');

  const identity=await observeTokenIdentity(input,memeToken);
  const [routeValue, keyValue, canonicalPoolIdValue, executorValue,
    quoteAssetValue, creatorTaxValue, realQuoteReserveValue, sellableTokensValue, reservedTokensValue, readyValue, feesValue,
    tokenMarketValue, tokenFactoryValue] = await Promise.all([
    readFunction(input, REGISTRY, f72ReadAbis.MarketRegistryV1 as Abi, 'canonicalRoute', [input.creation.marketId]),
    readFunction(input, REGISTRY, f72ReadAbis.MarketRegistryV1 as Abi, 'canonicalPoolKey', [input.creation.marketId]),
    readFunction(input, REGISTRY, f72ReadAbis.MarketRegistryV1 as Abi, 'canonicalPoolId', [input.creation.marketId]),
    readFunction(input, REGISTRY, f72ReadAbis.MarketRegistryV1 as Abi, 'graduationExecutor', []),
    readFunction(input, curve, f72ReadAbis.TickerGardenCurve as Abi, 'quoteAsset', []),
    readFunction(input, curve, f72ReadAbis.TickerGardenCurve as Abi, 'creatorTaxBps', []),
    readFunction(input, curve, f72ReadAbis.TickerGardenCurve as Abi, 'realQuoteReserve', []),
    readFunction(input, curve, f72ReadAbis.TickerGardenCurve as Abi, 'sellableTokens', []),
    readFunction(input, curve, f72ReadAbis.TickerGardenCurve as Abi, 'reservedTokens', []),
    readFunction(input, curve, f72ReadAbis.TickerGardenCurve as Abi, 'readyToGraduate', []),
    readFunction(input, curve, f72ReadAbis.TickerGardenCurve as Abi, 'accruedCurveFees', []),
    readFunction(input, memeToken, f72ReadAbis.TickerMemeTokenV1 as Abi, 'marketId', []),
    readFunction(input, memeToken, f72ReadAbis.TickerMemeTokenV1 as Abi, 'factory', []),
  ]);

  if (address(quoteAssetValue, 'curve quote asset') !== quoteAsset
    || safeNumber(creatorTaxValue, 16, 'curve creator tax') !== safeNumber(config.creatorTaxBps, 16, 'creatorTaxBps')) {
    throw new Error('curve binding mismatch');
  }
  if (hex32(tokenMarketValue, 'token market identity') !== input.creation.marketId || address(tokenFactoryValue, 'token factory') !== FACTORY) {
    throw new Error('market token identity mismatch');
  }

  const route = objectResult(routeValue);
  const routeKey = objectResult(route.poolKey);
  const key = objectResult(keyValue);
  const canonicalPoolId = hex32(canonicalPoolIdValue, 'canonicalPoolId');
  const encodedKey = await consensusRawCall(input, REGISTRY, f72ReadAbis.MarketRegistryV1 as Abi, 'canonicalPoolKey', [input.creation.marketId]);
  if (canonicalPoolId !== keccak256(encodedKey)) throw new Error('canonical PoolId mismatch');
  assertPoolKey(key, routeKey, quoteAsset, memeToken, address(config.graduatedHook, 'graduatedHook'), safeNumber(config.lpFeePips,24,'lpFeePips'));
  if (hex32(route.poolId, 'route poolId') !== canonicalPoolId
    || address(route.quoteAsset, 'route quoteAsset') !== quoteAsset || address(route.memeToken, 'route memeToken') !== memeToken
    || address(route.curve, 'route curve') !== curve || address(route.gauge, 'route gauge') !== gauge
    || safeNumber(route.sourceVersion, 32, 'route sourceVersion') !== sourceVersion
    || safeNumber(route.launchPhase, 8, 'route launchPhase') !== launchPhase) throw new Error('canonical route binding mismatch');
  const graduated = launchPhase === 1;
  if (Boolean(route.curveTradingEnabled) !== !graduated || Boolean(route.poolTradingEnabled) !== graduated
    || (graduated && poolId !== canonicalPoolId)) throw new Error('canonical route lifecycle mismatch');

  const display = await observeMarketDisplay(input, { memeToken, quoteAsset, curve, gauge, poolId, launchPhase, creatorTaxBps: safeNumber(config.creatorTaxBps, 16, 'creatorTaxBps') }).catch(() => undefined);
  const result = {
    ...(display ? {display} : {}),
    marketId: input.creation.marketId,
    assetUid: hex32(config.assetUid, 'assetUid'), memeToken, curve, gauge, quoteAsset,
    quoteAssetConfigId: hex32(config.quoteAssetConfigId, 'quoteAssetConfigId'),
    tickerGardenBaselineId: hex32(config.tickerGardenBaselineId, 'tickerGardenBaselineId'),
    sourceVersion, launchPhase,
    creator: address(config.creatorRevenueBeneficiaryAtCreation, 'creator'),
    creatorFeesToHolders: boolean(config.creatorFeesToHolders, 'creatorFeesToHolders'),
    stakingEnabled: boolean(config.stakingEnabled, 'stakingEnabled'),
    burnMemeFees: boolean(config.burnMemeFees, 'burnMemeFees'),
    lpFeePips: safeNumber(config.lpFeePips,24,'lpFeePips'),
    creatorTaxBps: safeNumber(config.creatorTaxBps,16,'creatorTaxBps'),
    curveProgress: {
      realQuoteReserve: bigint(realQuoteReserveValue, 'realQuoteReserve').toString(),
      sellableTokens: bigint(sellableTokensValue, 'sellableTokens').toString(),
      reservedTokens: bigint(reservedTokensValue, 'reservedTokens').toString(),
      accruedCurveFees: bigint(feesValue, 'accruedCurveFees').toString(), readyToGraduate: boolean(readyValue, 'readyToGraduate'),
    },
    poolId: graduated ? poolId : null,
    poolKey: graduated ? jsonPoolKey(key) : null,
    canonicalRoute: {
      router: externalTradingService(input.creation.source.chainId)?.router ?? ZERO_ADDRESS, quoter: externalTradingService(input.creation.source.chainId)?.quoter ?? ZERO_ADDRESS,
      hook: address(route.hook, 'route hook'), launchLocker: address(route.launchLocker, 'launchLocker'),
      graduationExecutor: address(executorValue, 'graduationExecutor'),
      curveTradingEnabled: Boolean(route.curveTradingEnabled), poolTradingEnabled: Boolean(route.poolTradingEnabled), sourceVersion, launchPhase,
    },
    source: input.creation.source,
    identity,
  } satisfies Json;
  return result;
}

/** Reuse only a previously verified identity from the same canonical creation. */
export async function observeTokenIdentity(input:ObserveF72MarketInput,memeToken:Address):Promise<NonNullable<MarketReadModel['identity']>>{
  const previous=input.previous;
  // Caller supplies a canonical persisted record (and rewinds it on reorg).
  // These token fields are immutable. Mutable bindings are still read below.
  const identity=previous?.identity && previous.marketId===input.creation.marketId
    && previous.memeToken===memeToken && previous.source.blockHash===input.creation.source.blockHash
    && previous.source.chainId===input.creation.source.chainId
    && BigInt(previous.identity.blockNumber)<=input.blockNumber ? previous.identity : undefined;
  if(identity)return identity;
  const [name,symbol,metadataURI,deployedAtValue,runtimeCodeHash]=await Promise.all([
    readFunction(input,memeToken,f72ReadAbis.TickerMemeTokenV1 as Abi,'name',[]),
    readFunction(input,memeToken,f72ReadAbis.TickerMemeTokenV1 as Abi,'symbol',[]),
    readFunction(input,memeToken,f72ReadAbis.TickerMemeTokenV1 as Abi,'metadataURI',[]),
    readFunction(input,memeToken,f72ReadAbis.TickerMemeTokenV1 as Abi,'deployedAt',[]),
    consensusCodeHash(input,memeToken),
  ]);
  const deployedAt=bigint(deployedAtValue,'deployedAt');
  if(deployedAt>input.blockTimestamp)throw Error('market deployment timestamp is after observation block');
  return {name:boundedString(name,'name',4096),symbol:boundedString(symbol,'symbol',4096),metadataURI:boundedString(metadataURI,'metadataURI',16384),deployedAt:deployedAt.toString(),blockNumber:input.blockNumber.toString(),blockHash:input.blockHash,runtimeCodeHash};
}

// These reads run in the asynchronous projector at one finalized block. HTTP
// display handlers only read the resulting published database record.
async function observeMarketDisplay(input: ObserveF72MarketInput, market: {
  memeToken: Address; quoteAsset: Address; curve: Address; gauge: Address; poolId: Hex; launchPhase: number; creatorTaxBps: number;
}): Promise<Json> {
  const abi = parseAbi([
    'function totalSupply() view returns (uint256)', 'function decimals() view returns (uint8)',
    'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
    'function effectiveTotalActiveStock() view returns (uint256)',
    'function marketAllocated(bytes32 assetUid, bytes32 marketId) view returns (uint256)',
    'function extsload(bytes32 slot) view returns (bytes32)',
  ]);
  const [supply, decimals, active, allocated] = await Promise.all([
    readFunction(input, market.memeToken, abi, 'totalSupply', []),
    market.quoteAsset === ZERO_ADDRESS ? 18 : readFunction(input, market.quoteAsset, abi, 'decimals', []),
    market.gauge === ZERO_ADDRESS ? 0n : readFunction(input, market.gauge, abi, 'effectiveTotalActiveStock', []),
    market.gauge === ZERO_ADDRESS ? 0n : readFunction(input, fixedF72Sources().find(source => source.module === 'UserStockVault')!.address, abi, 'marketAllocated', [input.creation.assetUid, input.creation.marketId]),
  ]);
  const quoteDecimals = safeNumber(decimals, 8, 'quoteDecimals');
  if (quoteDecimals > 18) throw new Error('unsupported quote decimals');
  let priceQuote: string | null;
  if (market.launchPhase === 0) {
    const reserves = await readFunction(input, market.curve, abi, 'getReserves', []) as readonly bigint[];
    priceQuote = reserves[1]! > 0n ? formatUnits(reserves[0]! * 10n ** 54n / reserves[1]! / 10n ** BigInt(quoteDecimals), 36) : null;
  } else {
    const slot = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [market.poolId, 6n]));
    const raw = await readFunction(input, f72EventCatalog.UniswapV4PoolManager.address, abi, 'extsload', [slot]);
    priceQuote = displayPoolPrice(BigInt(String(raw)) & ((1n << 160n) - 1n), market.memeToken < market.quoteAsset, quoteDecimals);
  }
  return { priceQuote, totalSupplyRaw: bigint(supply, 'totalSupply').toString(),
    totalStakedRaw: bigint(allocated, 'marketAllocated').toString(), activeStakeRaw: bigint(active, 'activeStake').toString(),
    creatorTaxBps: market.creatorTaxBps, asOfTimestamp: input.blockTimestamp.toString(),
    blockNumber: input.blockNumber.toString(), blockHash: input.blockHash };
}

export function displayPoolPrice(sqrt: bigint, memeIsCurrency0: boolean, quoteDecimals: number): string | null {
  if (sqrt <= 0n) return null;
  const squared = sqrt * sqrt, q192 = 1n << 192n;
  return formatUnits((memeIsCurrency0 ? squared * 10n ** 54n / q192 : q192 * 10n ** 54n / squared) / 10n ** BigInt(quoteDecimals), 36);
}

export async function projectF72Markets(input: {
  readonly pool:Pool;readonly deployment:DeploymentIdentity;readonly blockNumber:bigint;readonly blockHash:Hex;
  readonly blockTimestamp:bigint;readonly generation:bigint;readonly primary:RpcTransport;readonly secondary:RpcTransport;readonly schemaName?:string;
}):Promise<{revision:string;duplicate:boolean;records:number}>{
  const schema=identifier(input.schemaName??'tickergarden_serverless'),id=[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest];
  const algorithmVersion='f72-markets-v4-delta',args=[...id,input.blockHash,input.generation.toString(),algorithmVersion];
  const previous=(await input.pool.query<{revision:string;block_number:string;generation:string;payload:{algorithmVersion:string;recordCount:number;deltaDepth?:number}}>(`SELECT p.revision,p.block_number,p.generation,p.payload FROM ${schema}.publication_pointers pointer JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision) JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3 AND p.scope='markets' AND b.canonical AND b.finalized`,id)).rows[0];
  const publish={pool:input.pool,deployment:input.deployment,scope:'markets',algorithmVersion,incrementalMarketVersions:true,blockNumber:input.blockNumber,blockHash:input.blockHash,generation:input.generation,...(input.schemaName?{schemaName:input.schemaName}:{})};
  if(previous&&previous.payload.algorithmVersion===algorithmVersion&&BigInt(previous.generation)===input.generation&&BigInt(previous.block_number)===input.blockNumber){
    if(previous.revision!==`${input.blockNumber}:${input.blockHash}`||(await consensusBlock(input.primary,input.secondary,input.blockNumber)).hash!==input.blockHash)throw Error('market retry anchor changed');
    return acknowledgeMarketPublication({...publish,records:[]});
  }
  type Candidate={base_revision:string|null;expected_population:number;work_count:number};
  let candidate=(await input.pool.query<Candidate>(`SELECT base_revision,expected_population,work_count FROM ${schema}.market_work_candidates WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5 AND algorithm_version=$6`,args)).rows[0];
  if(!candidate){
    const reusable=previous&&previous.payload.algorithmVersion===algorithmVersion&&BigInt(previous.generation)===input.generation&&BigInt(previous.block_number)<input.blockNumber;
    const logs=reusable?(await input.pool.query<{payload:Record<string,unknown>}>(`SELECT l.payload FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.canonical AND b.canonical AND b.finalized AND b.number>$4 AND b.number<=$5`,[...id,previous.block_number,input.blockNumber.toString()])).rows:[];
    const dirty=marketDirtyKeys(logs.map(r=>r.payload));
    // Persist newly discovered creations without materializing every historical payload.
    await loadF72MarketCreations({pool:input.pool,deployment:input.deployment,throughBlock:input.blockNumber,marketIds:[],...(input.schemaName?{schemaName:input.schemaName}:{})});
    const directory=`FROM ${schema}.market_creation_directory d JOIN ${schema}.chain_blocks b ON b.environment=d.environment AND b.chain_id=d.chain_id AND b.deployment_digest=d.deployment_digest AND b.hash=d.block_hash`;
    const canonical=`d.environment=$1 AND d.chain_id=$2 AND d.deployment_digest=$3 AND b.canonical AND b.finalized AND b.number<=$4`;
    const population=(await input.pool.query<{n:number;distinct_n:number}>(`SELECT count(*)::int n,count(DISTINCT d.market_id)::int distinct_n ${directory} WHERE ${canonical}`,[...id,input.blockNumber.toString()])).rows[0]!;
    if(population.n!==population.distinct_n)throw Error('duplicate canonical MarketCreated identity');
    const governance= fixedF72Sources().filter(source=>/Registry|Config|AccessManager/.test(source.module)).some(source=>dirty.has(source.address));
    const pending=(await input.pool.query<{payload:MarketCreation}>(`SELECT d.payload ${directory}
      LEFT JOIN ${schema}.market_record_versions v ON v.environment=d.environment AND v.chain_id=d.chain_id AND v.deployment_digest=d.deployment_digest AND v.identity=d.market_id AND v.generation=$5 AND v.valid_from<=$6 AND (v.valid_to IS NULL OR v.valid_to>$6)
      LEFT JOIN ${schema}.market_time_refresh t ON t.environment=d.environment AND t.chain_id=d.chain_id AND t.deployment_digest=d.deployment_digest AND t.market_id=d.market_id AND t.generation=$5
      WHERE ${canonical} AND ($7 OR v.identity IS NULL OR v.payload->'display' IS NULL OR
        ARRAY[v.payload->>'marketId',v.payload->>'assetUid',v.payload->>'memeToken',v.payload->>'curve',v.payload->>'gauge',v.payload->>'poolId',v.payload->>'quoteAsset',v.payload->>'quoteAssetConfigId',v.payload->>'tickerGardenBaselineId'] && $8::text[] OR
        ((v.payload->'display'->>'totalStakedRaw')::numeric>0 AND (t.observed_block_hash IS DISTINCT FROM v.payload->'display'->>'blockHash' OR t.next_at<=$9::numeric))) ORDER BY d.market_id`,[...id,input.blockNumber.toString(),input.generation.toString(),reusable?previous.block_number:'-1',!reusable||governance,[...dirty],input.blockTimestamp.toString()])).rows.map(r=>r.payload);
    candidate={base_revision:reusable?previous.revision:null,expected_population:population.n,work_count:pending.length};
    await transaction(input.pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`market-work:${args.join(':')}`]);
      const exists=(await client.query<Candidate>(`SELECT base_revision,expected_population,work_count FROM ${schema}.market_work_candidates WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5 AND algorithm_version=$6`,args)).rows[0];
      if(exists){if(JSON.stringify(exists)!==JSON.stringify(candidate))throw Error('market work candidate conflict');return;}
      for(let offset=0;offset<pending.length;offset+=250)await client.query(`INSERT INTO ${schema}.market_observation_work SELECT $1,$2,$3,$4,$5,$6,r.creation->>'marketId',r.creation FROM jsonb_to_recordset($7::jsonb) r(creation jsonb)`,[...args,JSON.stringify(pending.slice(offset,offset+250).map(creation=>({creation})))]);
      await client.query(`INSERT INTO ${schema}.market_work_candidates VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[...args,candidate!.base_revision,candidate!.expected_population,candidate!.work_count]);
    });
  }
  const pending=(await input.pool.query<{creation:MarketCreation}>(`SELECT w.creation FROM ${schema}.market_observation_work w WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5 AND algorithm_version=$6 AND NOT EXISTS(SELECT 1 FROM ${schema}.projection_observations s WHERE s.environment=w.environment AND s.chain_id=w.chain_id AND s.deployment_digest=w.deployment_digest AND s.scope='markets' AND s.block_hash=w.block_hash AND s.generation=w.generation AND s.algorithm_version=w.algorithm_version AND s.identity=w.market_id) ORDER BY market_id LIMIT 129`,args)).rows.map(r=>r.creation);
  for(let offset=0;offset<Math.min(pending.length,128);offset+=8){
    const batch=pending.slice(offset,Math.min(offset+8,128));
    const cached=candidate.base_revision?(await input.pool.query<{identity:string;payload:MarketReadModel}>(`SELECT identity,payload FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4 AND identity=ANY($5::text[])`,[...id,candidate.base_revision,batch.map(c=>c.marketId)])).rows:[];
    const values=await mapBounded(batch,8,creation=>{const previous=cached.find(r=>r.identity===creation.marketId)?.payload;return observeF72Market({creation,blockNumber:input.blockNumber,blockHash:input.blockHash,blockTimestamp:input.blockTimestamp,primary:input.primary,secondary:input.secondary,...(previous?{previous}:{})});});
    if((await consensusBlock(input.primary,input.secondary,input.blockNumber)).hash!==input.blockHash)throw Error('market observation anchor changed');
    const schedules=await mapBounded(batch,8,(creation)=>nextMarketActivation({creation,blockNumber:input.blockNumber,blockHash:input.blockHash,blockTimestamp:input.blockTimestamp,primary:input.primary,secondary:input.secondary},values[batch.indexOf(creation)]!).catch(()=>input.blockTimestamp.toString()));
    if((await consensusBlock(input.primary,input.secondary,input.blockNumber)).hash!==input.blockHash)throw Error('market schedule anchor changed');
    const records=batch.map((c,i)=>({identity:c.marketId,payload:values[i]!}));
    const written=await input.pool.query(`INSERT INTO ${schema}.projection_observations AS current(environment,chain_id,deployment_digest,scope,block_number,block_hash,generation,algorithm_version,identity,payload) SELECT $1,$2,$3,'markets',$7,$4,$5,$6,r.identity,r.payload FROM jsonb_to_recordset($8::jsonb) r(identity text,payload jsonb) ON CONFLICT(environment,chain_id,deployment_digest,scope,block_hash,generation,algorithm_version,identity) DO UPDATE SET payload=current.payload WHERE current.payload=EXCLUDED.payload RETURNING identity`,[...args,input.blockNumber.toString(),JSON.stringify(records)]);
    if(written.rowCount!==records.length)throw Error('conflicting market observation at finalized anchor');
    await input.pool.query(`INSERT INTO ${schema}.market_time_refresh SELECT $1,$2,$3,$5,r.identity,$4,r.next_at FROM jsonb_to_recordset($6::jsonb) r(identity text,next_at bigint) ON CONFLICT(environment,chain_id,deployment_digest,generation,market_id) DO UPDATE SET observed_block_hash=excluded.observed_block_hash,next_at=excluded.next_at`,[...id,input.blockHash,input.generation.toString(),JSON.stringify(batch.map((c,i)=>({identity:c.marketId,next_at:schedules[i]})))]);
  }
  if(pending.length>128){const count=(await input.pool.query<{n:string}>(`SELECT count(*)::text n FROM ${schema}.projection_observations WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5 AND algorithm_version=$6 AND scope='markets'`,args)).rows[0];throw new ProjectionPending('markets',input.blockNumber,Number(count?.n));}
  const staged=(await input.pool.query<{identity:string;payload:Json}>(`SELECT identity,payload FROM ${schema}.projection_observations WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5 AND algorithm_version=$6 AND scope='markets'`,args)).rows;
  if(staged.length!==candidate.work_count)throw Error('market work coverage mismatch');
  const records=staged.map(r=>({identity:r.identity,sortKey:`${String((r.payload as any).source.blockNumber).padStart(20,'0')}:${r.identity}`,payload:r.payload}));
  if(candidate.base_revision&&(previous?.payload.deltaDepth??0)>=255){
    const base=(await input.pool.query<{identity:string;sort_key:string;payload:Json}>(`SELECT identity,sort_key,payload FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4`,[...id,candidate.base_revision])).rows;
    const complete=new Map(base.map(r=>[r.identity,{identity:r.identity,sortKey:r.sort_key,payload:r.payload}]));for(const r of records)complete.set(r.identity,r);
    if(complete.size!==candidate.expected_population)throw Error('full checkpoint population mismatch');
    return publishProjection({...publish,records:[...complete.values()]});
  }
  if(candidate.base_revision)return publishMarketDelta({...publish,records,baseRevision:candidate.base_revision,expectedPopulation:candidate.expected_population});
  return publishProjection({...publish,records});
}

export async function nextMarketActivation(input:ObserveF72MarketInput,payload:Json):Promise<string|null>{
  const display=(payload as any).display;
  if(!display)return input.blockTimestamp.toString();
  const total=BigInt(display.totalStakedRaw),active=BigInt(display.activeStakeRaw);
  if(active>total)throw Error('active stake exceeds allocated stake');
  if(total===active)return null;
  const abi=parseAbi(['function activationSlot(uint8 index) view returns ((uint64 generation,uint256 amount,uint256 refs))']);
  let next:bigint|null=null,pending=0n;
  for(let offset=0;offset<32;offset+=8){const slots=await Promise.all(Array.from({length:8},(_,i)=>readFunction(input,input.creation.gauge,abi,'activationSlot',[offset+i])));
    for(const raw of slots){const slot=objectResult(raw),generation=bigint(slot.generation,'activation generation'),amount=bigint(slot.amount,'activation amount');if(generation>input.blockTimestamp&&amount>0n){pending+=amount;if(next===null||generation<next)next=generation;}}
  }
  if(pending!==total-active||next===null)throw Error('activation schedule does not reconcile pending stake');
  return next.toString();
}

async function readFunction(input: ObserveF72MarketInput, target: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<unknown> {
  const raw = await consensusRawCall(input, target, abi, functionName, args);
  return functionName === 'market' ? decodeMarketRecord(raw) : functionName === 'canonicalRoute' ? decodeCoreMarketRoute(raw) : decodeFunctionResult({ abi, functionName, data: raw });
}

async function consensusRawCall(input: ObserveF72MarketInput, target: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName, args });
  if(input.primary.sameSource(input.secondary))return input.primary.callAt(target,data,input.blockNumber);
  const [first, second] = await Promise.all([input.primary.callAt(target, data, input.blockNumber), input.secondary.callAt(target, data, input.blockNumber)]);
  if (first !== second) throw new Error(`RPC providers disagree on ${functionName}`);
  return first;
}

async function consensusCodeHash(input: ObserveF72MarketInput, target: Address): Promise<Hex> {
  if(input.primary.sameSource(input.secondary))return input.primary.codeHash(target,input.blockNumber);
  const [first, second] = await Promise.all([input.primary.codeHash(target, input.blockNumber), input.secondary.codeHash(target, input.blockNumber)]);
  if (first !== second) throw new Error('RPC providers disagree on market runtime code hash');
  return first;
}

export function creationFromEvent(args: Readonly<Record<string, unknown>>, log: RpcLog, chainId: 4663 | 46630): MarketCreation {
  return {
    marketId: hex32(args.marketId, 'marketId'), assetUid: hex32(args.assetUid, 'assetUid'), memeToken: address(args.memeToken, 'memeToken'),
    curve: address(args.curve, 'curve'), gauge: address(args.gauge, 'gauge'), quoteAsset: address(args.quoteAsset, 'quoteAsset'),
    quoteAssetConfigId: hex32(args.quoteAssetConfigId, 'quoteAssetConfigId'), tickerGardenBaselineId: hex32(args.tickerGardenBaselineId, 'tickerGardenBaselineId'),
    expectedEconomics: hex32(args.expectedEconomics, 'expectedEconomics'),
    source: { chainId, blockNumber: log.blockNumber.toString(), blockHash: log.blockHash, transactionHash: log.transactionHash,
      transactionIndex: safeBigintNumber(log.transactionIndex, 'transactionIndex'), logIndex: safeBigintNumber(log.logIndex, 'logIndex') },
  };
}

function assertCreationMatches(creation: MarketCreation, config: Record<string, unknown>): void {
  for (const [field, expected] of Object.entries({ assetUid: creation.assetUid, memeToken: creation.memeToken, curve: creation.curve,
    gauge: creation.gauge, quoteAsset: creation.quoteAsset, quoteAssetConfigId: creation.quoteAssetConfigId,
    tickerGardenBaselineId: creation.tickerGardenBaselineId, expectedEconomics: creation.expectedEconomics })) {
    const actual = typeof expected === 'string' && expected.length === 42 ? address(config[field], field) : hex32(config[field], field);
    if (actual !== expected) throw new Error(`Factory event and market record mismatch: ${field}`);
  }
  if (hex32(config.executionSpecId, 'executionSpecId') !== EXECUTION_SPEC_ID) throw new Error('market execution spec mismatch');
  if (address(config.creatorRevenueBeneficiaryAtCreation, 'creator') === ZERO_ADDRESS
    || address(config.graduatedHook, 'graduatedHook') === ZERO_ADDRESS) throw new Error('market required address is zero');
  if (safeNumber(config.creatorTaxBps, 16, 'creatorTaxBps') > 500) throw new Error('market creator tax exceeds protocol bound');
}

function assertPoolKey(key: Record<string, unknown>, routeKey: Record<string, unknown>, quote: Address, meme: Address, hook: Address, lpFeePips: number): void {
  for (const field of ['currency0', 'currency1', 'fee', 'tickSpacing', 'hooks']) {
    if (String(key[field]).toLowerCase() !== String(routeKey[field]).toLowerCase()) throw new Error(`route PoolKey mismatch: ${field}`);
  }
  const currencies = [quote, meme].sort();
  const spacing = safeSignedNumber(key.tickSpacing, 24, 'tickSpacing');
  if (address(key.currency0, 'currency0') !== currencies[0] || address(key.currency1, 'currency1') !== currencies[1]
    || address(key.hooks, 'hooks') !== hook || (![0,1000,2000,3000].includes(lpFeePips) || safeNumber(key.fee, 24, 'fee') !== lpFeePips) || spacing < 1 || spacing > 32767) {
    throw new Error('canonical PoolKey identity mismatch');
  }
}

function jsonPoolKey(key: Record<string, unknown>): Json {
  return { currency0: address(key.currency0, 'currency0'), currency1: address(key.currency1, 'currency1'),
    fee: safeNumber(key.fee, 24, 'fee'), tickSpacing: safeSignedNumber(key.tickSpacing, 24, 'tickSpacing'), hooks: address(key.hooks, 'hooks') };
}

function parseStoredLog(value: Record<string, unknown>): RpcLog {
  return {
    address: address(value.address, 'log address'), blockHash: hex32(value.blockHash, 'blockHash'),
    blockNumber: bigint(value.blockNumber, 'blockNumber'), transactionHash: hex32(value.transactionHash, 'transactionHash'),
    transactionIndex: bigint(value.transactionIndex, 'transactionIndex'), logIndex: bigint(value.logIndex, 'logIndex'),
    data: hex(value.data, 'data'), topics: array(value.topics, 'topics').map((topic) => hex32(topic, 'topic')), removed: value.removed === true,
  };
}

function objectResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('contract result is not a named tuple');
  return value as Record<string, unknown>;
}
function address(value: unknown, label: string): Address { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} is not an address`); return value.toLowerCase() as Address; }
function hex32(value: unknown, label: string): Hex { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} is not bytes32`); return value.toLowerCase() as Hex; }
function hex(value: unknown, label: string): Hex { if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error(`${label} is not hex bytes`); return value.toLowerCase() as Hex; }
function bigint(value: unknown, label: string): bigint { if (typeof value === 'bigint' && value >= 0n) return value; if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value); if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value); throw new Error(`${label} is not an unsigned integer`); }
function safeBigintNumber(value: bigint, label: string): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} exceeds JSON safe integer`); return number; }
function safeNumber(value: unknown, bits: number, label: string): number { const parsed = bigint(value, label); if (parsed >= 1n << BigInt(bits)) throw new Error(`${label} exceeds uint${bits}`); return Number(parsed); }
function safeSignedNumber(value: unknown, bits: number, label: string): number { const parsed = typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : typeof value === 'bigint' ? value : undefined; if (parsed === undefined) throw new Error(`${label} is not a signed integer`); const min = -(1n << BigInt(bits - 1)); const max = (1n << BigInt(bits - 1)) - 1n; if (parsed < min || parsed > max) throw new Error(`${label} exceeds int${bits}`); return Number(parsed); }
function boolean(value: unknown, label: string): boolean { if (typeof value !== 'boolean') throw new Error(`${label} is not boolean`); return value; }
function boundedString(value: unknown, label: string, maximumBytes: number): string { if (typeof value !== 'string' || Buffer.byteLength(value) > maximumBytes) throw new Error(`${label} exceeds bound or is not text`); return value; }
function array(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${label} is not an array`); return value; }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"`; }

async function mapBounded<T, R>(values: readonly T[], concurrency: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor++; output[index] = await fn(values[index]!); }
  }));
  return output;
}

export function marketDirtyKeys(logs:readonly Record<string,unknown>[]):Set<string>{
  const keys=new Set<string>();
  for(const log of logs){
    if(typeof log.address==='string')keys.add(log.address.toLowerCase());
    const words=[...(Array.isArray(log.topics)?log.topics:[]),...(typeof log.data==='string'?log.data.slice(2).match(/.{64}/g)?.map(x=>'0x'+x)??[]:[])];
    for(const word of words)if(typeof word==='string'&&!/^0x0+$/i.test(word)){keys.add(word.toLowerCase());if(/^0x0{24}[0-9a-f]{40}$/i.test(word))keys.add('0x'+word.slice(-40).toLowerCase());}
  }
  return keys;
}
export function marketNeedsObservation(record:Record<string,any>,keys:ReadonlySet<string>,at?:bigint):boolean{
  // Staking activation evolves with block time even without a new market log.
  if(!record.display)return true;
  if(BigInt(record.display.totalStakedRaw??'0')>0n){
    const schedule=record.observationSchedule;
    if(at===undefined||!schedule||schedule.hash!==record.display.blockHash)return true;
    if(schedule.nextAt!==null&&BigInt(schedule.nextAt)<=at)return true;
  }
  const candidates=[record.marketId,record.assetUid,record.memeToken,record.curve,record.gauge,record.poolId,record.quoteAsset,record.quoteAssetConfigId,record.tickerGardenBaselineId];
  if(candidates.some(key=>typeof key==='string'&&keys.has(key.toLowerCase())))return true;
  // Governance/config changes can affect arbitrary markets: refresh conservatively.
  return fixedF72Sources().filter(source=>/Registry|Config|AccessManager/.test(source.module)).some(source=>keys.has(source.address));
}
