import { decodeCoreMarketRoute } from '../../chain/src/market-route.ts';
import { externalTradingService } from '../../chain/src/external-trading.ts';
import type { Pool } from 'pg';
import {
  decodeFunctionResult, encodeFunctionData, keccak256, type Abi, type Address, type Hex,
} from 'viem';
import type { DeploymentIdentity, RpcLog, RpcTransport } from '../../chain/src/index.ts';
import { decodeF72Event, eventTopic, f72EventCatalog, f72ReadAbis } from '../../events/src/index.ts';
import { publishProjection, type Json, type ProjectionRecord } from '../../projection/src/index.ts';

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
  readonly creation: MarketCreation;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly blockTimestamp: bigint;
  readonly primary: RpcTransport;
  readonly secondary: RpcTransport;
}

export async function loadF72MarketCreations(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly throughBlock: bigint; readonly schemaName?: string;
}): Promise<MarketCreation[]> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const rows = await input.pool.query<{ payload: Record<string, unknown> }>(
    `SELECT l.payload FROM ${schema}.chain_logs l
     JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
     WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.address=$4 AND l.topic0=$5
       AND l.canonical AND b.canonical AND b.finalized AND b.number<=$6
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
  return [...creations.values()];
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

  const [routeValue, keyValue, canonicalPoolIdValue, executorValue,
    quoteAssetValue, creatorTaxValue, realQuoteReserveValue, sellableTokensValue, reservedTokensValue, readyValue, feesValue,
    tokenMarketValue, tokenFactoryValue, nameValue, symbolValue, metadataValue, deployedAtValue, tokenCodeHash] = await Promise.all([
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
    readFunction(input, memeToken, f72ReadAbis.TickerMemeTokenV1 as Abi, 'name', []),
    readFunction(input, memeToken, f72ReadAbis.TickerMemeTokenV1 as Abi, 'symbol', []),
    readFunction(input, memeToken, f72ReadAbis.TickerMemeTokenV1 as Abi, 'metadataURI', []),
    readFunction(input, memeToken, f72ReadAbis.TickerMemeTokenV1 as Abi, 'deployedAt', []),
    consensusCodeHash(input, memeToken),
  ]);

  if (address(quoteAssetValue, 'curve quote asset') !== quoteAsset
    || safeNumber(creatorTaxValue, 16, 'curve creator tax') !== safeNumber(config.creatorTaxBps, 16, 'creatorTaxBps')) {
    throw new Error('curve binding mismatch');
  }
  if (hex32(tokenMarketValue, 'token market identity') !== input.creation.marketId || address(tokenFactoryValue, 'token factory') !== FACTORY) {
    throw new Error('market token identity mismatch');
  }
  const deployedAt = bigint(deployedAtValue, 'deployedAt');
  if (deployedAt > input.blockTimestamp) throw new Error('market deployment timestamp is after observation block');

  const route = objectResult(routeValue);
  const routeKey = objectResult(route.poolKey);
  const key = objectResult(keyValue);
  const canonicalPoolId = hex32(canonicalPoolIdValue, 'canonicalPoolId');
  const encodedKey = await consensusRawCall(input, REGISTRY, f72ReadAbis.MarketRegistryV1 as Abi, 'canonicalPoolKey', [input.creation.marketId]);
  if (canonicalPoolId !== keccak256(encodedKey)) throw new Error('canonical PoolId mismatch');
  assertPoolKey(key, routeKey, quoteAsset, memeToken, address(config.graduatedHook, 'graduatedHook'));
  if (hex32(route.poolId, 'route poolId') !== canonicalPoolId
    || address(route.quoteAsset, 'route quoteAsset') !== quoteAsset || address(route.memeToken, 'route memeToken') !== memeToken
    || address(route.curve, 'route curve') !== curve || address(route.gauge, 'route gauge') !== gauge
    || safeNumber(route.sourceVersion, 32, 'route sourceVersion') !== sourceVersion
    || safeNumber(route.launchPhase, 8, 'route launchPhase') !== launchPhase) throw new Error('canonical route binding mismatch');
  const graduated = launchPhase === 1;
  if (Boolean(route.curveTradingEnabled) !== !graduated || Boolean(route.poolTradingEnabled) !== graduated
    || (graduated && poolId !== canonicalPoolId)) throw new Error('canonical route lifecycle mismatch');

  const result = {
    marketId: input.creation.marketId,
    assetUid: hex32(config.assetUid, 'assetUid'), memeToken, curve, gauge, quoteAsset,
    quoteAssetConfigId: hex32(config.quoteAssetConfigId, 'quoteAssetConfigId'),
    tickerGardenBaselineId: hex32(config.tickerGardenBaselineId, 'tickerGardenBaselineId'),
    sourceVersion, launchPhase,
    creator: address(config.creatorRevenueBeneficiaryAtCreation, 'creator'),
    creatorFeesToHolders: boolean(config.creatorFeesToHolders, 'creatorFeesToHolders'),
    stakingEnabled: boolean(config.stakingEnabled, 'stakingEnabled'),
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
    identity: {
      name: boundedString(nameValue, 'name', 4096), symbol: boundedString(symbolValue, 'symbol', 4096),
      metadataURI: boundedString(metadataValue, 'metadataURI', 16384), deployedAt: deployedAt.toString(),
      blockNumber: input.blockNumber.toString(), blockHash: input.blockHash, runtimeCodeHash: tokenCodeHash,
    },
  } satisfies Json;
  return result;
}

export async function projectF72Markets(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly blockNumber: bigint; readonly blockHash: Hex;
  readonly blockTimestamp: bigint; readonly generation: bigint; readonly primary: RpcTransport; readonly secondary: RpcTransport;
  readonly schemaName?: string;
}): Promise<{ revision: string; duplicate: boolean; records: number }> {
  const creations = await loadF72MarketCreations({ pool: input.pool, deployment: input.deployment, throughBlock: input.blockNumber, ...(input.schemaName ? { schemaName: input.schemaName } : {}) });
  if (creations.length > 10_000) throw new Error('market projection exceeds bounded release scope');
  const observed = await mapBounded(creations, 8, (creation) => observeF72Market({
    creation, blockNumber: input.blockNumber, blockHash: input.blockHash, blockTimestamp: input.blockTimestamp,
    primary: input.primary, secondary: input.secondary,
  }));
  const records: ProjectionRecord[] = observed.map((payload, index) => {
    const creation = creations[index]!;
    return { identity: creation.marketId, sortKey: `${creation.source.blockNumber.padStart(20, '0')}:${creation.marketId}`, payload };
  });
  return publishProjection({
    pool: input.pool, deployment: input.deployment, scope: 'markets', algorithmVersion: 'f72-markets-v1',
    blockNumber: input.blockNumber, blockHash: input.blockHash, generation: input.generation, records,
    ...(input.schemaName ? { schemaName: input.schemaName } : {}),
  });
}

async function readFunction(input: ObserveF72MarketInput, target: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<unknown> {
  const raw = await consensusRawCall(input, target, abi, functionName, args);
  return functionName === 'canonicalRoute' ? decodeCoreMarketRoute(raw) : decodeFunctionResult({ abi, functionName, data: raw });
}

async function consensusRawCall(input: ObserveF72MarketInput, target: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName, args });
  const [first, second] = await Promise.all([input.primary.callAt(target, data, input.blockNumber), input.secondary.callAt(target, data, input.blockNumber)]);
  if (first !== second) throw new Error(`RPC providers disagree on ${functionName}`);
  return first;
}

async function consensusCodeHash(input: ObserveF72MarketInput, target: Address): Promise<Hex> {
  const [first, second] = await Promise.all([input.primary.codeHash(target, input.blockNumber), input.secondary.codeHash(target, input.blockNumber)]);
  if (first !== second) throw new Error('RPC providers disagree on market runtime code hash');
  return first;
}

function creationFromEvent(args: Readonly<Record<string, unknown>>, log: RpcLog, chainId: 4663 | 46630): MarketCreation {
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

function assertPoolKey(key: Record<string, unknown>, routeKey: Record<string, unknown>, quote: Address, meme: Address, hook: Address): void {
  for (const field of ['currency0', 'currency1', 'fee', 'tickSpacing', 'hooks']) {
    if (String(key[field]).toLowerCase() !== String(routeKey[field]).toLowerCase()) throw new Error(`route PoolKey mismatch: ${field}`);
  }
  const currencies = [quote, meme].sort();
  const spacing = safeSignedNumber(key.tickSpacing, 24, 'tickSpacing');
  if (address(key.currency0, 'currency0') !== currencies[0] || address(key.currency1, 'currency1') !== currencies[1]
    || address(key.hooks, 'hooks') !== hook || safeNumber(key.fee, 24, 'fee') !== 0 || spacing < 1 || spacing > 32767) {
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
