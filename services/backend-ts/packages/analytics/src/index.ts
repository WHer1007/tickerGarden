import { f72EventCatalog, type DecodedProtocolEvent } from '../../events/src/index.ts';

export type Address = `0x${string}`;
export type Hex32 = `0x${string}`;
export type TradeClassification = 'unclassified' | 'internal_reward_conversion' | 'internal_holder_conversion';

export interface TradeSource {
  readonly chainId: 4663 | 46630;
  readonly blockNumber: string;
  readonly blockHash: Hex32;
  readonly transactionHash: Hex32;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly emitter: Address;
  readonly eventKey: string;
}

export interface CandlePrice { readonly numerator: string; readonly denominator: string }
export interface TradeActivity {
  readonly source: TradeSource;
  readonly venue: 'curve' | 'pool';
  readonly marketId: Hex32;
  readonly timestamp: string;
  readonly side: 'buy' | 'sell';
  readonly classification: TradeClassification;
  readonly actor: Address | null;
  readonly actorConfidence: 'contract_caller_not_verified_wallet' | 'unavailable';
  readonly recipient: Address | null;
  readonly memeAsset: Address;
  readonly quoteAsset: Address;
  readonly quoteDecimals: number;
  readonly memeRaw: string;
  readonly quoteRaw: string;
  readonly amountBasis: 'CURVE_EXCLUDING_FEE_TAX' | 'POOL_CORE';
  readonly price: CandlePrice;
  readonly priceUnit: 'QUOTE_PER_WHOLE_MEME';
  readonly feeRaw: string | null;
  readonly feeAsset: Address | null;
  readonly taxRaw: string | null;
  readonly feeStatus: 'event_reported' | 'paired_event' | 'not_provided';
}

export interface MarketBinding {
  readonly chainId: 4663 | 46630;
  readonly marketId: Hex32;
  readonly memeAsset: Address;
  readonly quoteAsset: Address;
  readonly quoteDecimals: number;
  readonly curve: Address;
  readonly hook: Address;
  readonly poolId: Hex32 | null;
  readonly lpFeePips?: number;
  readonly currency0: Address | null;
  readonly currency1: Address | null;
}

export interface EventObservation {
  readonly event: DecodedProtocolEvent;
  readonly timestamp: bigint;
}

export interface Candle {
  readonly timestamp: number;
  readonly open: CandlePrice | null;
  readonly high: CandlePrice | null;
  readonly low: CandlePrice | null;
  readonly close: CandlePrice | null;
  readonly memeVolumeRaw: string;
  readonly quoteVolumeRaw: string;
  readonly internalMemeVolumeRaw: string;
  readonly internalQuoteVolumeRaw: string;
  readonly tradeCount: number;
  readonly internalTradeCount: number;
  readonly unclassifiedTradeCount: number;
}

export interface CandleSeries {
  readonly candles: readonly Candle[];
  readonly priceUnit: 'QUOTE_PER_WHOLE_MEME';
  readonly volumeBasis: 'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE';
  readonly pricePopulation: 'ALL_EXECUTIONS_INCLUDING_INTERNAL_CONVERSIONS';
  readonly emptyPolicy: 'NULL_OHLC_ZERO_VOLUME';
}

export interface HolderTransfer { readonly source: TradeSource; readonly from: Address; readonly to: Address; readonly value: string }
export interface HolderBalance { readonly account: Address; readonly balanceRaw: string; readonly excluded: boolean }
export interface HolderSnapshot {
  readonly totalSupplyRaw: string;
  readonly positiveAddressCount: number;
  readonly includedAddressCount: number;
  readonly excludedAccounts: readonly Address[];
  readonly balances: readonly HolderBalance[];
}

const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as Address;
const UINT256_MAX = 1n << 256n;
const INT128_MIN = -(1n << 127n);
const INT128_MAX = (1n << 127n) - 1n;

export function normalizeTransaction(observations: readonly EventObservation[], bindings: readonly MarketBinding[]): TradeActivity[] {
  if (observations.length > 10_000 || bindings.length > 10_000) throw new Error('analytics input exceeds bound');
  const ordered = [...observations].sort(compareObservations);
  assertSingleOrderedTransaction(ordered);
  const byCurve = uniqueMap(bindings.filter((item) => item.curve !== ZERO_ADDRESS), (item) => item.curve);
  const byPool = uniqueMap(bindings.filter((item) => item.poolId !== null), (item) => item.poolId!);
  const trades: TradeActivity[] = [];
  const tradeByLog = new Map<number, number>();

  for (let index = 0; index < ordered.length; index += 1) {
    const observation = ordered[index]!;
    const { event } = observation;
    let trade: TradeActivity | null = null;
    if (event.module === 'TickerGardenCurve' && (event.eventName === 'CurveBuy' || event.eventName === 'CurveSell')) {
      const binding = byCurve.get(event.log.address);
      if (!binding) throw new Error('curve trade has no authenticated market binding');
      trade = normalizeCurve(observation, binding);
    } else if (event.module === 'UniswapV4PoolManager' && event.eventName === 'Swap') {
      const poolId = hex32(event.args.id, 'pool id');
      const binding = byPool.get(poolId);
      if (!binding) continue;
      const nextSwap = ordered.findIndex((item, candidate) => candidate > index && item.event.module === 'UniswapV4PoolManager' && item.event.eventName === 'Swap');
      const fees = ordered.slice(index + 1, nextSwap === -1 ? undefined : nextSwap)
        .filter((item) => item.event.module === 'TickerGardenMemeHook' && item.event.eventName === 'V4FeeAccrued'
          && item.event.args.poolId === poolId && item.event.args.marketId === binding.marketId);
      if (fees.length > 1) throw new Error('pool execution has ambiguous fee events');
      const fee = fees[0]?.event ?? null;
      trade = normalizePool(observation, binding, fee);
    }
    if (trade) {
      tradeByLog.set(trade.source.logIndex, trades.length);
      trades.push(trade);
    }
  }

  for (const observation of ordered) {
    const classification = conversionClassification(observation.event);
    if (!classification) continue;
    const marketId = hex32(observation.event.args.marketId, 'conversion market');
    const conversionMeme = address(observation.event.args.memeAsset, 'conversion meme asset');
    const conversionQuote = address(observation.event.args.quoteAsset, 'conversion quote asset');
    const conversionBinding = bindings.find((binding) => binding.marketId === marketId);
    if (!conversionBinding) throw new Error('conversion summary has no market binding');
    const memeSpent = uint256(observation.event.args.memeSpent, 'conversion meme amount');
    const quoteReceived = uint256(observation.event.args.quoteReceived, 'conversion quote amount');
    const candidate = [...tradeByLog.entries()].reverse().find(([logIndex, tradeIndex]) => {
      const trade = trades[tradeIndex]!;
      return logIndex < Number(observation.event.log.logIndex) && trade.marketId === marketId && trade.venue === 'pool'
        && trade.actor === conversionBinding.hook
        && trade.memeAsset === conversionMeme && trade.quoteAsset === conversionQuote
        && trade.side === 'sell' && trade.memeRaw === memeSpent.toString() && trade.quoteRaw === quoteReceived.toString()
        && trade.classification === 'unclassified';
    });
    if (!candidate) throw new Error('conversion summary has no unique preceding pool execution');
    const sameCandidates = trades.filter((trade) => trade.source.logIndex < Number(observation.event.log.logIndex)
      && trade.marketId === marketId && trade.venue === 'pool' && trade.side === 'sell'
      && trade.actor === conversionBinding.hook
      && trade.memeAsset === conversionMeme && trade.quoteAsset === conversionQuote
      && trade.memeRaw === memeSpent.toString() && trade.quoteRaw === quoteReceived.toString() && trade.classification === 'unclassified');
    if (sameCandidates.length !== 1) throw new Error('conversion summary is ambiguous');
    const tradeIndex = candidate[1];
    trades[tradeIndex] = { ...trades[tradeIndex]!, classification };
  }
  return trades;
}

export function buildCandles(input: {
  readonly chainId: 4663 | 46630; readonly marketId: Hex32; readonly memeAsset: Address; readonly quoteAsset: Address;
  readonly quoteDecimals: number; readonly from: number; readonly to: number; readonly interval: 60 | 300 | 900 | 3600 | 14400 | 86400;
  readonly trades: readonly TradeActivity[];
}): CandleSeries {
  if (!Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || input.from < 0 || input.to <= input.from
    || input.from % input.interval !== 0 || input.to % input.interval !== 0 || (input.to - input.from) / input.interval > 2_000) throw new Error('invalid candle window');
  const candles: MutableCandle[] = Array.from({ length: (input.to - input.from) / input.interval }, (_, index) => ({
    timestamp: input.from + index * input.interval, open: null, high: null, low: null, close: null,
    memeVolumeRaw: '0', quoteVolumeRaw: '0', internalMemeVolumeRaw: '0', internalQuoteVolumeRaw: '0',
    tradeCount: 0, internalTradeCount: 0, unclassifiedTradeCount: 0,
  }));
  const ordered = [...input.trades].sort(compareTradesAscending);
  const seen = new Set<string>();
  for (const trade of ordered) {
    const timestamp = safeTimestamp(trade.timestamp);
    if (trade.source.chainId !== input.chainId || trade.marketId !== input.marketId || trade.memeAsset !== input.memeAsset
      || trade.quoteAsset !== input.quoteAsset || trade.quoteDecimals !== input.quoteDecimals || timestamp < input.from || timestamp >= input.to
      || seen.has(trade.source.eventKey)) throw new Error('trade is outside candle identity or window');
    seen.add(trade.source.eventKey);
    const candle = candles[Math.floor((timestamp - input.from) / input.interval)]!;
    const price = reducePrice(trade.price);
    candle.open ??= price;
    if (!candle.high || comparePrice(price, candle.high) > 0) candle.high = price;
    if (!candle.low || comparePrice(price, candle.low) < 0) candle.low = price;
    candle.close = price;
    candle.memeVolumeRaw = addUint(candle.memeVolumeRaw, trade.memeRaw);
    candle.quoteVolumeRaw = addUint(candle.quoteVolumeRaw, trade.quoteRaw);
    candle.tradeCount += 1;
    if (trade.classification === 'unclassified') candle.unclassifiedTradeCount += 1;
    else {
      candle.internalTradeCount += 1;
      candle.internalMemeVolumeRaw = addUint(candle.internalMemeVolumeRaw, trade.memeRaw);
      candle.internalQuoteVolumeRaw = addUint(candle.internalQuoteVolumeRaw, trade.quoteRaw);
    }
  }
  return { candles, priceUnit: 'QUOTE_PER_WHOLE_MEME', volumeBasis: 'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',
    pricePopulation: 'ALL_EXECUTIONS_INCLUDING_INTERNAL_CONVERSIONS', emptyPolicy: 'NULL_OHLC_ZERO_VOLUME' };
}

export function rebuildHolderSnapshot(input: {
  readonly chainId: 4663 | 46630; readonly token: Address; readonly initialHolder: Address; readonly burnAuthority: Address | null; readonly allowSelfBurn?: boolean; readonly initialSupplyRaw: string;
  readonly transfers: readonly HolderTransfer[]; readonly excludedAccounts: readonly Address[];
}): HolderSnapshot {
  const supplyInitial = uint256(input.initialSupplyRaw, 'initial supply');
  if (supplyInitial === 0n || input.transfers.length === 0 || input.transfers.length > 1_000_000 || input.excludedAccounts.length > 1_000) throw new Error('invalid holder input');
  const exclusions = new Set(input.excludedAccounts);
  if (exclusions.size !== input.excludedAccounts.length || exclusions.has(ZERO_ADDRESS)) throw new Error('invalid holder exclusions');
  for (const account of exclusions) address(account, 'excluded account');
  const ordered = [...input.transfers].sort((left, right) => compareSources(left.source, right.source));
  const balances = new Map<Address, bigint>();
  const seen = new Set<string>();
  let supply = 0n;
  for (const [index, transfer] of ordered.entries()) {
    if (transfer.source.chainId !== input.chainId || transfer.source.emitter !== input.token || seen.has(transfer.source.eventKey)) throw new Error('invalid holder transfer source');
    seen.add(transfer.source.eventKey);
    const from = address(transfer.from, 'transfer from');
    const to = address(transfer.to, 'transfer to');
    const value = uint256(transfer.value, 'transfer value');
    if (index === 0) {
      if (from !== ZERO_ADDRESS || to !== input.initialHolder || value !== supplyInitial) throw new Error('invalid initial mint');
      supply = value;
      balances.set(to, value);
      continue;
    }
    if (from === ZERO_ADDRESS) throw new Error('unexpected mint after creation');
    const fromBalance = balances.get(from) ?? 0n;
    if (fromBalance < value) throw new Error('holder balance underflow');
    balances.set(from, fromBalance - value);
    if (to === ZERO_ADDRESS) {
      if (!input.allowSelfBurn && (input.burnAuthority === null || from !== input.burnAuthority || value === 0n)) throw new Error('unauthorized holder burn');
      supply -= value;
    }
    else balances.set(to, (balances.get(to) ?? 0n) + value);
  }
  const positive = [...balances.entries()].filter(([, balance]) => balance > 0n).sort(([left], [right]) => left.localeCompare(right));
  if (positive.reduce((sum, [, balance]) => sum + balance, 0n) !== supply) throw new Error('holder supply does not reconcile');
  const rows = positive.map(([account, balanceRaw]) => ({ account, balanceRaw: balanceRaw.toString(), excluded: exclusions.has(account) }));
  return { totalSupplyRaw: supply.toString(), positiveAddressCount: rows.length, includedAddressCount: rows.filter((row) => !row.excluded).length,
    excludedAccounts: [...exclusions].sort(), balances: rows };
}

export function transferFromObservation(observation: EventObservation, chainId: 4663 | 46630): HolderTransfer {
  if (observation.event.module !== 'TickerMemeTokenV1' || observation.event.eventName !== 'Transfer') throw new Error('event is not a token transfer');
  return { source: source(observation.event, chainId), from: address(observation.event.args.from, 'transfer from'),
    to: address(observation.event.args.to, 'transfer to'), value: uint256(observation.event.args.value, 'transfer value').toString() };
}

function normalizeCurve(observation: EventObservation, binding: MarketBinding): TradeActivity {
  const buy = observation.event.eventName === 'CurveBuy';
  const meme = uint256(observation.event.args[buy ? 'tokensOut' : 'tokensIn'], 'curve meme amount');
  const cash = uint256(observation.event.args[buy ? 'quoteIn' : 'quoteOut'], 'curve quote cash flow');
  const fee = uint256(observation.event.args.fee, 'curve fee');
  const tax = uint256(observation.event.args.tax, 'curve tax');
  const quote = buy ? cash - fee - tax : cash + fee + tax;
  if (meme <= 0n || cash <= 0n || quote <= 0n) throw new Error('invalid curve trade amount');
  const actor = address(observation.event.args[buy ? 'buyer' : 'seller'], 'curve actor');
  return { source: source(observation.event, binding.chainId), venue: 'curve', marketId: binding.marketId,
    timestamp: observation.timestamp.toString(), side: buy ? 'buy' : 'sell', classification: 'unclassified', actor,
    actorConfidence: 'contract_caller_not_verified_wallet', recipient: address(observation.event.args.recipient, 'curve recipient'),
    memeAsset: binding.memeAsset, quoteAsset: binding.quoteAsset, quoteDecimals: binding.quoteDecimals,
    memeRaw: meme.toString(), quoteRaw: quote.toString(), amountBasis: 'CURVE_EXCLUDING_FEE_TAX', price: price(meme, quote, binding.quoteDecimals),
    priceUnit: 'QUOTE_PER_WHOLE_MEME', feeRaw: fee.toString(), feeAsset: binding.quoteAsset, taxRaw: tax.toString(), feeStatus: 'event_reported' };
}

function normalizePool(observation: EventObservation, binding: MarketBinding, feeEvent: DecodedProtocolEvent | null): TradeActivity {
  if (!binding.poolId || !binding.currency0 || !binding.currency1 || binding.currency0 >= binding.currency1) throw new Error('invalid pool binding');
  const amount0 = int128(observation.event.args.amount0, 'amount0');
  const amount1 = int128(observation.event.args.amount1, 'amount1');
  if ((amount0 < 0n) === (amount1 < 0n) || amount0 === 0n || amount1 === 0n) throw new Error('invalid pool core deltas');
  const lpFee = binding.lpFeePips ?? 0;
  const actualFee = uint256(observation.event.args.fee, 'pool fee');
  // v4 Swap reports the combined input fee: protocol + LP - floor(protocol * LP / 1e6).
  if (![0,1000,2000,3000].includes(lpFee) || actualFee < BigInt(lpFee)
      || actualFee > BigInt(lpFee + 1000 - Math.floor(lpFee * 1000 / 1_000_000))) throw new Error('invalid pool fee');
  const memeDelta = binding.memeAsset === binding.currency0 ? amount0 : binding.memeAsset === binding.currency1 ? amount1 : null;
  const quoteDelta = binding.quoteAsset === binding.currency0 ? amount0 : binding.quoteAsset === binding.currency1 ? amount1 : null;
  if (memeDelta === null || quoteDelta === null || (memeDelta < 0n) === (quoteDelta < 0n)) throw new Error('pool assets do not match binding');
  const meme = absolute(memeDelta); const quote = absolute(quoteDelta);
  let feeRaw: string | null = null; let feeAsset: Address | null = null; let feeStatus: 'paired_event' | 'not_provided' = 'not_provided';
  if (feeEvent) {
    if (feeEvent.log.address !== binding.hook) throw new Error('pool fee emitter mismatch');
    if (feeEvent.args.marketId !== binding.marketId || feeEvent.args.poolId !== binding.poolId) throw new Error('pool fee identity mismatch');
    feeAsset = address(feeEvent.args.feeAsset, 'fee asset');
    if (feeAsset !== binding.memeAsset && feeAsset !== binding.quoteAsset) throw new Error('pool fee asset mismatch');
    const base = uint256(feeEvent.args.base, 'fee base'); const total = uint256(feeEvent.args.totalFee, 'total fee');
    const lp = uint256(feeEvent.args.lpAmount, 'LP fee'); const nonLp = uint256(feeEvent.args.nonLpAmount, 'non-LP fee');
    if (total === 0n || lp + nonLp !== total || base !== (feeAsset === binding.memeAsset ? meme : quote)) throw new Error('pool fee amount mismatch');
    feeRaw = total.toString(); feeStatus = 'paired_event';
  }
  const sender = typeof observation.event.args.sender === 'string' && /^0x[0-9a-fA-F]{40}$/.test(observation.event.args.sender)
    ? observation.event.args.sender.toLowerCase() as Address : null;
  return { source: source(observation.event, binding.chainId), venue: 'pool', marketId: binding.marketId,
    timestamp: observation.timestamp.toString(), side: memeDelta > 0n ? 'buy' : 'sell', classification: 'unclassified', actor: sender,
    actorConfidence: sender ? 'contract_caller_not_verified_wallet' : 'unavailable', recipient: null, memeAsset: binding.memeAsset,
    quoteAsset: binding.quoteAsset, quoteDecimals: binding.quoteDecimals, memeRaw: meme.toString(), quoteRaw: quote.toString(),
    amountBasis: 'POOL_CORE', price: price(meme, quote, binding.quoteDecimals), priceUnit: 'QUOTE_PER_WHOLE_MEME',
    feeRaw, feeAsset, taxRaw: null, feeStatus };
}

function conversionClassification(event: DecodedProtocolEvent): TradeClassification | null {
  if (event.module !== 'ProtocolFeeVault' || event.log.address !== f72EventCatalog.ProtocolFeeVault.address) return null;
  if (event.eventName === 'RewardBatchConverted') {
    if (uint256(event.args.nonce, 'conversion nonce') === 0n) throw new Error('invalid conversion nonce');
    return 'internal_reward_conversion';
  }
  if (event.eventName === 'HolderRewardsConverted') {
    if (uint256(event.args.epochId, 'holder epoch') >= 1n << 32n) throw new Error('invalid holder epoch');
    return 'internal_holder_conversion';
  }
  return null;
}

function source(event: DecodedProtocolEvent, chainId: 4663 | 46630): TradeSource {
  return { chainId, blockNumber: event.log.blockNumber.toString(), blockHash: event.log.blockHash, transactionHash: event.log.transactionHash,
    transactionIndex: safeNumber(event.log.transactionIndex, 'transaction index'), logIndex: safeNumber(event.log.logIndex, 'log index'),
    emitter: event.log.address, eventKey: `${chainId}:${event.log.transactionHash}:${event.log.logIndex}` };
}
function price(meme: bigint, quote: bigint, quoteDecimals: number): CandlePrice {
  if (quoteDecimals < 6 || quoteDecimals > 18) throw new Error('invalid quote decimals');
  return reducePrice({ numerator: (quote * 10n ** 18n).toString(), denominator: (meme * 10n ** BigInt(quoteDecimals)).toString() });
}
function reducePrice(value: CandlePrice): CandlePrice { const n = uint256(value.numerator, 'price numerator'); const d = uint256(value.denominator, 'price denominator'); if (!n || !d) throw new Error('zero price'); const divisor = gcd(n, d); return { numerator: (n / divisor).toString(), denominator: (d / divisor).toString() }; }
function gcd(a: bigint, b: bigint): bigint { let x = a; let y = b; while (y) [x, y] = [y, x % y]; return x; }
function comparePrice(left: CandlePrice, right: CandlePrice): number { const value = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator); return value < 0n ? -1 : value > 0n ? 1 : 0; }
function addUint(left: string, right: string): string { return (uint256(left, 'aggregate') + uint256(right, 'amount')).toString(); }
function uint256(value: unknown, label: string): bigint {
  const supported = typeof value === 'string' || typeof value === 'bigint'
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  if (!supported || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error(`${label} is not uint256`);
  const result = BigInt(value as string | number | bigint);
  if (result >= UINT256_MAX) throw new Error(`${label} exceeds uint256`);
  return result;
}
function int128(value: unknown, label: string): bigint { if ((typeof value !== 'string' && typeof value !== 'bigint') || !/^(0|-?[1-9][0-9]*)$/.test(String(value))) throw new Error(`${label} is not int128`); const result = BigInt(value); if (result < INT128_MIN || result > INT128_MAX) throw new Error(`${label} exceeds int128`); return result; }
function address(value: unknown, label: string): Address { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} is not an address`); return value.toLowerCase() as Address; }
function hex32(value: unknown, label: string): Hex32 { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} is not bytes32`); return value.toLowerCase() as Hex32; }
function safeNumber(value: bigint, label: string): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} exceeds JSON integer`); return result; }
function safeTimestamp(value: string): number { const parsed = uint256(value, 'timestamp'); return safeNumber(parsed, 'timestamp'); }
function absolute(value: bigint): bigint { return value < 0n ? -value : value; }
function compareSources(left: TradeSource, right: TradeSource): number { const block = BigInt(left.blockNumber) - BigInt(right.blockNumber); if (block) return block < 0n ? -1 : 1; return left.transactionIndex - right.transactionIndex || left.logIndex - right.logIndex; }
function compareTradesAscending(left: TradeActivity, right: TradeActivity): number { return compareSources(left.source, right.source); }
function compareObservations(left: EventObservation, right: EventObservation): number { const block = left.event.log.blockNumber - right.event.log.blockNumber; if (block) return block < 0n ? -1 : 1; return Number(left.event.log.transactionIndex - right.event.log.transactionIndex) || Number(left.event.log.logIndex - right.event.log.logIndex); }
function assertSingleOrderedTransaction(values: readonly EventObservation[]): void { for (let index = 1; index < values.length; index += 1) { const left = values[index - 1]!.event.log; const right = values[index]!.event.log; if (left.blockHash !== right.blockHash || left.transactionHash !== right.transactionHash || left.logIndex >= right.logIndex) throw new Error('observations must be one ordered transaction'); } }
function uniqueMap<T>(values: readonly T[], key: (value: T) => string): Map<string, T> { const result = new Map<string, T>(); for (const value of values) { const identity = key(value); if (result.has(identity)) throw new Error('duplicate analytics binding'); result.set(identity, value); } return result; }

type MutableCandle = { -readonly [Key in keyof Candle]: Candle[Key] };
