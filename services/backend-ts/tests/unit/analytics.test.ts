import assert from 'node:assert/strict';
import test from 'node:test';
import { f72EventCatalog, type DecodedProtocolEvent } from '../../packages/events/src/index.ts';
import { buildCandles, normalizeTransaction, rebuildHolderSnapshot, type EventObservation, type MarketBinding, type TradeSource } from '../../packages/analytics/src/index.ts';

const address = (value: string): `0x${string}` => `0x${value.repeat(40)}`;
const hash = (value: string): `0x${string}` => `0x${value.repeat(64)}`;
const market: MarketBinding = { chainId: 46630, marketId: hash('1'), memeAsset: address('2'), quoteAsset: address('3'), quoteDecimals: 6,
  curve: address('4'), hook: address('b'), poolId: hash('5'), currency0: address('2'), currency1: address('3') };

function observation(module: DecodedProtocolEvent['module'], eventName: string, emitter: `0x${string}`, logIndex: bigint,
  args: Record<string, unknown>, timestamp = 7_200n): EventObservation {
  return { timestamp, event: { module, eventName, args, log: { address: emitter, blockNumber: 100n, blockHash: hash('6'),
    transactionHash: hash('7'), transactionIndex: 2n, logIndex, data: '0x', topics: [], removed: false } } };
}

test('normalizes Curve cash flow without fee and tax in price consideration', () => {
  const [trade] = normalizeTransaction([observation('TickerGardenCurve', 'CurveBuy', market.curve, 1n,
    { buyer: address('8'), recipient: address('9'), quoteIn: 1_030_000n, tokensOut: 2n * 10n ** 18n, fee: 20_000n, tax: 10_000n })], [market]);
  assert.equal(trade?.quoteRaw, '1000000');
  assert.deepEqual(trade?.price, { numerator: '1', denominator: '2' });
  assert.equal(trade?.feeStatus, 'event_reported');
});

test('normalizes a graduated Pool execution and binds its fee across same-transaction events', () => {
  const trades = normalizeTransaction([
    observation('UniswapV4PoolManager', 'Swap', f72EventCatalog.UniswapV4PoolManager.address, 1n,
      { id: market.poolId, sender: address('8'), amount0: 2n * 10n ** 18n, amount1: -1_000_000n, fee: 0 }),
    observation('TickerMemeTokenV1', 'Transfer', market.memeAsset, 2n,
      { from: address('8'), to: address('9'), value: 1n }),
    observation('TickerGardenMemeHook', 'V4FeeAccrued', market.hook, 3n,
      { marketId: market.marketId, poolId: market.poolId, feeAsset: market.quoteAsset, feeNonce: 1n, feeId: hash('a'),
        base: 1_000_000n, totalFee: 3_000n, lpAmount: 2_000n, nonLpAmount: 1_000n }),
  ], [market]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0]?.venue, 'pool');
  assert.equal(trades[0]?.side, 'buy');
  assert.equal(trades[0]?.feeRaw, '3000');
  assert.equal(trades[0]?.feeStatus, 'paired_event');
});

for (const [eventName, classification] of [['RewardBatchConverted', 'internal_reward_conversion'], ['HolderRewardsConverted', 'internal_holder_conversion']] as const) {
  test(`links a unique Hook pool sell to ${eventName} without creating a second trade`, () => {
    const observations = [
      observation('UniswapV4PoolManager', 'Swap', address('a'), 3n,
        { id: market.poolId, sender: address('b'), amount0: -(2n * 10n ** 18n), amount1: 1_000_000n, fee: 0n }),
      observation('ProtocolFeeVault', eventName, f72EventCatalog.ProtocolFeeVault.address, 5n,
        { marketId: market.marketId, memeAsset: market.memeAsset, quoteAsset: market.quoteAsset,
          memeSpent: 2n * 10n ** 18n, quoteReceived: 1_000_000n, nonce: 1n, epochId: 1n }),
    ];
    const trades = normalizeTransaction(observations, [market]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]?.classification, classification);
    assert.equal(trades[0]?.feeStatus, 'not_provided');
  });
}

test('builds exact candles and leaves uncovered-by-trades buckets null with zero volume', () => {
  const trades = normalizeTransaction([observation('TickerGardenCurve', 'CurveSell', market.curve, 1n,
    { seller: address('8'), recipient: address('9'), quoteOut: 980_000n, tokensIn: 2n * 10n ** 18n, fee: 10_000n, tax: 10_000n }, 7_201n)], [market]);
  const series = buildCandles({ chainId: 46630, marketId: market.marketId, memeAsset: market.memeAsset, quoteAsset: market.quoteAsset,
    quoteDecimals: 6, from: 7_200, to: 14_400, interval: 3_600, trades });
  assert.deepEqual(series.candles[0]?.open, { numerator: '1', denominator: '2' });
  assert.equal(series.candles[0]?.quoteVolumeRaw, '1000000');
  assert.deepEqual(series.candles[1], { timestamp: 10_800, open: null, high: null, low: null, close: null,
    memeVolumeRaw: '0', quoteVolumeRaw: '0', internalMemeVolumeRaw: '0', internalQuoteVolumeRaw: '0',
    tradeCount: 0, internalTradeCount: 0, unclassifiedTradeCount: 0 });
});

test('replays holder transfers, preserves excluded balances, and reconciles supply', () => {
  const curve = market.curve; const user = address('8'); const source = (logIndex: number): TradeSource => ({ chainId: 46630,
    blockNumber: '100', blockHash: hash('6'), transactionHash: hash(String(logIndex)), transactionIndex: logIndex,
    logIndex, emitter: market.memeAsset, eventKey: `46630:${hash(String(logIndex))}:${logIndex}` });
  const snapshot = rebuildHolderSnapshot({ chainId: 46630, token: market.memeAsset, initialHolder: curve, burnAuthority: address('c'), initialSupplyRaw: '1000',
    excludedAccounts: [curve], transfers: [
      { source: source(1), from: address('0'), to: curve, value: '1000' },
      { source: source(2), from: curve, to: user, value: '250' },
    ] });
  assert.equal(snapshot.totalSupplyRaw, '1000');
  assert.equal(snapshot.positiveAddressCount, 2);
  assert.equal(snapshot.includedAddressCount, 1);
  assert.deepEqual(snapshot.balances, [
    { account: market.curve, balanceRaw: '750', excluded: true },
    { account: user, balanceRaw: '250', excluded: false },
  ]);
});

test('rejects extra mint and ambiguous conversion evidence', () => {
  const source: TradeSource = { chainId: 46630, blockNumber: '100', blockHash: hash('6'), transactionHash: hash('7'),
    transactionIndex: 1, logIndex: 1, emitter: market.memeAsset, eventKey: `46630:${hash('7')}:1` };
  assert.throws(() => rebuildHolderSnapshot({ chainId: 46630, token: market.memeAsset, initialHolder: market.curve, burnAuthority: address('c'), initialSupplyRaw: '1000',
    excludedAccounts: [], transfers: [{ source, from: address('0'), to: market.curve, value: '1000' },
      { source: { ...source, logIndex: 2, eventKey: `46630:${hash('7')}:2` }, from: address('0'), to: address('8'), value: '1' }] }), /unexpected mint/);
});

test('nonzero static LP fees and bounded Core fees preserve trade history',()=>{
 for(const lpFeePips of [0,1000,2000,3000]) {
  const binding={...market,lpFeePips};
  const swap=(fee:number)=>observation('UniswapV4PoolManager','Swap',f72EventCatalog.UniswapV4PoolManager.address,1n,{id:market.poolId,sender:address('8'),amount0:2n*10n**18n,amount1:-1_000_000n,fee});
  const max=lpFeePips+1000-Math.floor(lpFeePips/1000);
  assert.equal(normalizeTransaction([swap(lpFeePips)],[binding]).length,1);
  assert.equal(normalizeTransaction([swap(max)],[binding]).length,1);
  assert.throws(()=>normalizeTransaction([swap(max+1)],[binding]),/invalid pool fee/);
  if(lpFeePips)assert.throws(()=>normalizeTransaction([swap(0)],[binding]),/invalid pool fee/);
 }
});
