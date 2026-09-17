import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TickerGardenApiError } from '../src/v1/generated/read-api.ts';
import { readPublishedMarket,marketIdentityPending } from '../src/v1/pendingMarket.ts';
import { createSnapshotPoller } from '../src/v1/snapshotUpdates.ts';

const marketId = `0x${'a'.repeat(64)}` as `0x${string}`;
const hash = (n: string) => `0x${n.repeat(64)}`;
const sync = (blockNumber: string, blockHash = hash(blockNumber)) => ({
  chainId: 4663 as const, status: 'synced' as const, finality: 'finalized' as const,
  blockNumber, blockHash, revision: `${blockNumber}:${blockHash}`,
  headBlockNumber: null, headBlockHash: null, lagBlocks: null,
});
const detail = (s = sync('1')) => ({ market: { marketId }, sync: s } as any);
const missing = (s: ReturnType<typeof sync>, status = 404, error = 'market_not_found') =>
  new TickerGardenApiError(status, { error, message: 'missing', sync: s } as any);

test('validated market_not_found at the requested finalized revision returns null', async () => {
  const revision = sync('1').revision;
  assert.equal(await readPublishedMarket(async () => { throw missing(sync('1')); }, marketId, revision), null);
});

test('only the matching finalized absence is recoverable', async () => {
  const revision = sync('1').revision;
  for (const error of [
    missing(sync('1'), 503),
    new Error('network'),
    missing(sync('1'), 404, 'not_found'),
    missing(sync('2'), 404),
  ]) {
    await assert.rejects(() => readPublishedMarket(async () => { throw error; }, marketId, revision));
  }
  await assert.rejects(() => readPublishedMarket(async () => detail(sync('2')), marketId, revision));
  await assert.rejects(() => readPublishedMarket(async () => detail(sync('1')), `0x${'b'.repeat(64)}`, revision));
});

test('a pending market recovers on the next finalized snapshot without unavailable callback', async t => {
  const old = sync('1');
  const next = sync('2');
  const updates = [
    { mode: 'reset' as const, pollAfterMs: 5000 as const, invalidated: ['markets', 'configs', 'positions', 'accounts'] as const, sync: old },
    { mode: 'changed' as const, pollAfterMs: 5000 as const, invalidated: ['markets'] as const, sync: next },
  ];
  let fetches = 0;
  let reads = 0;
  let committed = false;
  let unavailable = 0;
  const poller = createSnapshotPoller({
    chainId: 4663,
    fetchUpdate: async () => updates[Math.min(fetches++, 1)]!,
    prepare: async update => {
      const result = await readPublishedMarket(async () => {
        reads++;
        if (update.sync === old) throw missing(old);
        return detail(next);
      }, marketId, update.sync.revision);
      if (update.sync === next) assert.ok(result);
      return () => { committed = true; };
    },
    unavailable: () => { unavailable++; },
  });
  t.after(() => poller.stop());
  poller.start();
  await new Promise(resolve => setTimeout(resolve, 30));
  poller.reconnect();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(reads, 2);
  assert.equal(committed, true);
  assert.equal(unavailable, 0);
  assert.equal(poller.revision, next.revision);
});

test('published market without hydrated identity stays preparing until details are ready',()=>{
 assert.equal(marketIdentityPending({}),true);
 assert.equal(marketIdentityPending({identity:undefined}),true);
 assert.equal(marketIdentityPending({identity:{name:'Genesis Seed',symbol:'SEED',metadataURI:'ipfs://test',deployedAt:'1'}} as any),false);
});
