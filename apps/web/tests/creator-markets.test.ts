import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCreatorMarketPage, loadCreatorMarkets } from '../src/v1/creatorMarkets.ts';

const account = '0x' + 'a'.repeat(40);
const item = (n: number, creator = account) => ({ marketId: '0x' + n.toString(16).padStart(64, '0'), memeToken: '0x' + 'b'.repeat(40), creator, creationBlockNumber: String(n) });
function page(items: unknown[], extra: Record<string, unknown> = {}) { return { chainId: 4663, address: account, displayOnly: true, complete: true, items, nextCursor: null, ...extra }; }
async function withFetch(responses: unknown[], fn: () => Promise<unknown>) {
  const old = globalThis.fetch; let i = 0;
  globalThis.fetch = (async () => new Response(JSON.stringify(responses[i++]), { status: 200 })) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = old; }
}

test('empty and correct-owner directories load', async () => {
  assert.deepEqual(await withFetch([page([])], () => loadCreatorMarkets('https://api.test', 4663, account)), []);
  assert.equal((await withFetch([page([item(1)])], () => loadCreatorMarkets('https://api.test', 4663, account)) as Array<unknown>).length, 1);
});

test('wrong owner and chain mismatch are rejected', async () => {
  await assert.rejects(() => withFetch([page([item(1, '0x' + 'c'.repeat(40))])], () => loadCreatorMarkets('https://api.test', 4663, account)));
  await assert.rejects(() => withFetch([{ ...page([]), chainId: 1 }], () => loadCreatorMarkets('https://api.test', 4663, account)));
});

test('incomplete response throws without returning partial items', async () => {
  await assert.rejects(() => withFetch([{ ...page([item(1)]), complete: false }], () => loadCreatorMarkets('https://api.test', 4663, account)), { message: 'Creator Directory Updating' });
});

test('pagination collects pages and rejects duplicates', async () => {
  const calls: string[] = [];
  const old = globalThis.fetch;
  globalThis.fetch = (async (input) => { calls.push(String(input)); return new Response(JSON.stringify(calls.length === 1 ? page([item(1)], { nextCursor: 'next' }) : page([item(2)]))); }) as typeof fetch;
  try { assert.equal((await loadCreatorMarkets('https://api.test', 4663, account)).length, 2); assert.match(calls[1]!, /cursor=next/); }
  finally { globalThis.fetch = old; }
  await assert.rejects(() => withFetch([page([item(1)], { nextCursor: 'next' }), page([item(1)])], () => loadCreatorMarkets('https://api.test', 4663, account)));
});

test('page loader requests limit 50 and continues with the supplied cursor', async () => {
  const calls: string[] = [];
  const old = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify(page([item(2)], { nextCursor: 'next-2' })));
  }) as typeof fetch;
  try {
    const result = await loadCreatorMarketPage('https://api.test', 4663, account, undefined, 'next-1', [item(1).marketId]);
    assert.equal(result.nextCursor, 'next-2');
    assert.deepEqual(result.items, [item(2)]);
    assert.match(calls[0]!, /limit=50/);
    assert.match(calls[0]!, /cursor=next-1/);
    assert.match(calls[0]!, /address=0x[a]+/);
  } finally { globalThis.fetch = old; }
});

test('page loader rejects a market already seen on a previous page', async () => {
  await assert.rejects(
    () => withFetch([page([item(1)])], () => loadCreatorMarketPage('https://api.test', 4663, account, undefined, 'next', [item(1).marketId])),
    { message: 'Invalid creator market directory response' },
  );
});

test('page loader rejects a repeated continuation cursor', async () => {
  await assert.rejects(
    () => withFetch([page([item(1)], { nextCursor: 'same' })], () => loadCreatorMarketPage('https://api.test', 4663, account, undefined, 'same')),
    { message: 'Invalid continuation' },
  );
});

test('page loader rejects wrong wallet and chain', async () => {
  await assert.rejects(() => withFetch([page([item(1, '0x' + 'c'.repeat(40))])], () => loadCreatorMarketPage('https://api.test', 4663, account)));
  await assert.rejects(() => withFetch([{ ...page([]), chainId: 46630 }], () => loadCreatorMarketPage('https://api.test', 4663, account)));
});
