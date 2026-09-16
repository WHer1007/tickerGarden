import assert from 'node:assert/strict';
import test from 'node:test';
import { fixedF72Sources, f72EventCatalog } from '../../packages/events/src/index.ts';
import { marketDirtyKeys, marketNeedsObservation } from '../../packages/market-projector/src/index.ts';

const h = (c: string): `0x${string}` => `0x${c.repeat(64)}`;
const a = (c: string): `0x${string}` => `0x${c.repeat(40)}`;
const record = (extra: Record<string, unknown> = {}) => ({ marketId: h('1'), assetUid: h('2'), memeToken: a('3'), curve: a('4'), gauge: a('5'), poolId: h('6'), quoteAsset: a('7'), quoteAssetConfigId: h('8'), tickerGardenBaselineId: h('9'), creator: a('a'), display: { totalStakedRaw: '0' }, ...extra });

test('unchanged market with zero staking can reuse its observation', () => {
  assert.equal(marketNeedsObservation(record(), new Set()), false);
  assert.equal(marketNeedsObservation(record(), new Set([record().creator])), false, 'creator wallet transfers do not change immutable creation metadata');
  assert.equal(marketNeedsObservation(record({ display: undefined }), new Set()), true);
});

test('nonzero staking and indexed market or pool identities require observation', () => {
  assert.equal(marketNeedsObservation(record({ display: { totalStakedRaw: '1' } }), new Set()), true);
  assert.equal(marketNeedsObservation(record(), new Set([h('1')])), true);
  assert.equal(marketNeedsObservation(record(), new Set([h('6')])), true);
});

test('dirty keys include emitters, indexed ids and padded ABI token addresses', () => {
  const token = a('b');
  const keys = marketDirtyKeys([{ address: a('c'), topics: [h('d'), h('e')], data: `0x${token.slice(2).padStart(64, '0')}` }]);
  assert.ok(keys.has(a('c')));
  assert.ok(keys.has(h('e')));
  assert.ok(keys.has(token));
});

test('curve emitter, Registry and governance changes trigger only affected or global refresh', () => {
  const current = record();
  assert.equal(marketNeedsObservation(current, marketDirtyKeys([{ address: current.curve }])), true);
  const registry = f72EventCatalog.MarketRegistryV1.address;
  assert.equal(marketNeedsObservation(current, new Set([registry])), true);
  const governance = fixedF72Sources().find(source => /AccessManager|Config/.test(source.module));
  assert.ok(governance);
  assert.equal(marketNeedsObservation(current, new Set([governance.address])), true);
  assert.equal(marketNeedsObservation(record({ marketId: h('f') }), new Set([current.marketId])), false);
});

test('verified activation schedule refreshes when due and rejects stale observations',()=>{
 const current=record({display:{totalStakedRaw:'100',activeStakeRaw:'50',blockHash:h('b')},observationSchedule:{hash:h('b'),nextAt:'101'}});
 assert.equal(marketNeedsObservation(current,new Set(),100n),false);
 assert.equal(marketNeedsObservation(current,new Set(),101n),true);
 assert.equal(marketNeedsObservation({...current,observationSchedule:{hash:h('b'),nextAt:null}},new Set(),1000n),false);
 assert.equal(marketNeedsObservation({...current,observationSchedule:{hash:h('c'),nextAt:null}},new Set(),100n),true);
 assert.equal(marketNeedsObservation(current,new Set([current.gauge]),100n),true);
});

test('zero ABI fields do not dirty every native-quote market',()=>{
 const current=record({quoteAsset:a('0')});
 const dirty=marketDirtyKeys([{address:a('c'),topics:[h('d'),h('0')],data:h('0')}]);
 assert.equal(dirty.has(h('0')),false);assert.equal(dirty.has(a('0')),false);
 assert.equal(marketNeedsObservation(current,dirty),false);
});
