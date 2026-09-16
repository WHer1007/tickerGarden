import assert from "node:assert/strict";
import test from "node:test";
import { createExplorePager } from "../src/v1/explorePaging.ts";

type Item = { marketId: string; value?: number };

test("numbered navigation exposes reachable pages and reuses cached pages", async () => {
  const calls: (string | undefined)[] = [];
  const pager = createExplorePager<Item>(1, async (_query, cursor) => {
    calls.push(cursor);
    const index = cursor ? Number(cursor) : 1;
    return { items: [{ marketId: String(index) }], nextCursor: index < 3 ? String(index + 1) : null };
  });
  assert.equal((await pager.load({}))?.availablePages, 2);
  assert.equal((await pager.load({}, 2))?.availablePages, 3);
  assert.equal((await pager.load({}, 3))?.hasNext, false);
  assert.equal((await pager.load({}, 1))?.page, 1);
  assert.equal((await pager.load({}, 1))?.availablePages, 3);
  assert.equal((await pager.load({}, 3))?.page, 3);
  assert.deepEqual(calls, [undefined, "2", "3"]);
  await assert.rejects(pager.load({}, 0), /invalid page number/);
  await assert.rejects(pager.load({}, 4), /missing cursor/);
});
const page = (ids: string[], nextCursor: string | null = null) => ({
  items: ids.map((marketId) => ({ marketId })),
  nextCursor,
});

test("uses the requested page sizes", async () => {
  for (const size of [10, 40]) {
    const limits: number[] = [];
    const pager = createExplorePager<Item>(size, async (_q, cursor, limit) => {
      limits.push(limit);
      return page(cursor ? ["b"] : ["a"], cursor ? null : "next");
    });
    await pager.load({ sort: "x" });
    await pager.load({ sort: "x" }, "next");
    assert.deepEqual(limits, [size, size]);
  }
});

test("controllers keep independent caches", async () => {
  let callsA = 0;
  let callsB = 0;
  const a = createExplorePager<Item>(10, async () => { callsA++; return page(["a"]); });
  const b = createExplorePager<Item>(10, async () => { callsB++; return page(["b"]); });
  assert.equal((await a.load({}))?.items[0]?.marketId, "a");
  assert.equal((await b.load({}))?.items[0]?.marketId, "b");
  assert.equal(callsA, 1);
  assert.equal(callsB, 1);
});

test("query sorting resets to the first page", async () => {
  const seen: string[] = [];
  const pager = createExplorePager<Item>(10, async (query, cursor) => {
    seen.push(`${JSON.stringify(query)}:${cursor ?? "first"}`);
    return cursor ? page(["second"]) : page(["first"], "cursor");
  });
  await pager.load({ sort: "price", direction: "asc" });
  await pager.load({ sort: "price", direction: "desc" });
  assert.deepEqual(seen, [
    '{"sort":"price","direction":"asc"}:first',
    '{"sort":"price","direction":"desc"}:first',
  ]);
});

test("previous navigation uses the cached page", async () => {
  let calls = 0;
  const pager = createExplorePager<Item>(10, async (_q, cursor) => {
    calls++;
    return cursor ? page(["two"]) : page(["one"], "cursor");
  });
  await pager.load({});
  await pager.load({}, "next");
  assert.equal((await pager.load({}, "previous"))?.items[0]?.marketId, "one");
  assert.equal(calls, 2);
});

test("late completion from an old query returns null", async () => {
  let resolveOld!: (value: { items: readonly Item[]; nextCursor: string | null }) => void;
  const old = new Promise<{ items: readonly Item[]; nextCursor: string | null }>((resolve) => { resolveOld = resolve; });
  const pager = createExplorePager<Item>(10, async (query) => query.id === "old" ? old : page(["new"]));
  const oldLoad = pager.load({ id: "old" });
  const newLoad = pager.load({ id: "new" });
  assert.equal((await newLoad)?.items[0]?.marketId, "new");
  resolveOld(page(["old"]));
  assert.equal(await oldLoad, null);
});

test("rejects invalid pages and duplicate ids", async () => {
  const cases = [
    async () => page(["a", "a"]),
    async () => page(["a"], ""),
    async () => ({ items: [], nextCursor: "cursor" }),
  ];
  for (const fetchPage of cases) {
    const pager = createExplorePager<Item>(10, fetchPage);
    await assert.rejects(() => pager.load({}));
  }
});

test("fetch failure retains the prior page", async () => {
  let fail = false;
  const pager = createExplorePager<Item>(10, async (_q, cursor) => {
    if (cursor && fail) throw new Error("network");
    return cursor ? page(["two"]) : page(["one"], "cursor");
  });
  const first = await pager.load({});
  fail = true;
  await assert.rejects(() => pager.load({}, "next"), /network/);
  assert.deepEqual(await pager.load({}), first);
});

test('background revisions preserve the current cursor publication; filters still reset',async()=>{
 const calls:Array<{revision:string;cursor?:string}>=[];
 const pager=createExplorePager<Item>(1,async(query,cursor)=>{calls.push({revision:query.revision,cursor});return {items:[{marketId:cursor??'first'}],nextCursor:cursor==='third'?null:cursor?'third':'second'};});
 await pager.load({revision:'old',sort:'price'});
 await pager.load({revision:'old',sort:'price'},'next');
 assert.equal((await pager.load({revision:'new',sort:'price'}))?.page,2);
 await pager.load({revision:'new',sort:'price'},'next');
 assert.deepEqual(calls.map(v=>v.revision),['old','old','old']);
 assert.equal((await pager.load({revision:'new',sort:'name'}))?.page,1);
 assert.equal(calls.at(-1)?.revision,'new');
});

test('an interrupted background request preserves the loaded cursor page and ignores late results',async()=>{
 const requests:Array<{cursor:string|undefined;signal:AbortSignal;resolve:(value:ReturnType<typeof page>)=>void}>=[];
 const pager=createExplorePager<Item>(1,(_query,cursor,_limit,signal)=>new Promise(resolve=>requests.push({cursor,signal,resolve})));
 const first=pager.load({revision:'one'});requests[0]!.resolve(page(['first'],'second'));await first;
 const second=pager.load({revision:'one'},'next');requests[1]!.resolve(page(['second'],'third'));await second;
 const pending=pager.load({revision:'one'},'next');
 pager.pause();assert.equal(requests[2]!.signal.aborted,true);
 assert.equal((await pager.load({revision:'two'}))?.page,2);
 assert.equal(requests.length,3,'recovery retains the current page without a duplicate request');
 const retry=pager.load({revision:'two'},'next');
 requests[2]!.resolve(page(['late-old-third']));assert.equal(await pending,null);
 requests[3]!.resolve(page(['third']));
 assert.deepEqual((await retry)?.items,[{marketId:'third'}]);
 assert.equal((await pager.load({revision:'two'},'previous'))?.page,2);
});

test('background revision change cannot cancel an in-flight next page', async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  const pending = new Promise<ReturnType<typeof page>>(resolve => { finish = resolve; });
  const calls: string[] = [];
  const pager = createExplorePager<Item>(10, async (query, cursor, _limit, signal) => {
    calls.push(query.revision);
    if (!cursor) return page(['first'], 'next');
    const result = await pending;
    assert.equal(signal.aborted, false);
    return result;
  });
  await pager.load({ revision: 'old', sort: 'name' });
  const next = pager.load({ revision: 'old', sort: 'name' }, 'next');
  const refresh = pager.load({ revision: 'new', sort: 'name' });
  finish(page(['second']));
  assert.equal((await next)?.page, 2);
  assert.equal((await refresh)?.page, 2);
  assert.deepEqual(calls, ['old', 'old']);
});


test("next from visible first page keeps its revision when a newer bootstrap arrived", async () => {
  const seen: object[] = [];
  const pager = createExplorePager<Item>(10, async (query, cursor) => {
    seen.push(query);
    return cursor ? page(["second"]) : page(["first"], "cursor");
  });
  await pager.load({ revision: "old", sort: "created" });
  const next = await pager.load({ revision: "new", sort: "created" }, "next");
  assert.equal(next?.page, 2);
  assert.deepEqual(next?.items, [{marketId: "second"}]);
  assert.deepEqual(seen, [{ revision: "old", sort: "created" }, { revision: "old", sort: "created" }]);
});


test("a recent-market hint cannot cancel an in-flight next page", async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  const pending = new Promise<ReturnType<typeof page>>(resolve => {finish=resolve;});
  const pager = createExplorePager<Item>(10, async (_query, cursor) => cursor ? pending : page(["first"],"cursor"));
  await pager.load({revision:"r"});
  const next = pager.load({revision:"r"},"next");
  assert.equal(pager.refreshFirstPage(),false);
  const refresh = pager.load({revision:"r"});
  finish(page(["second"]));
  assert.equal((await next)?.page,2);
  assert.equal((await refresh)?.page,2);
  assert.equal(pager.refreshFirstPage(),false);
  await pager.load({revision:"r"},"previous");
  assert.equal(pager.refreshFirstPage(),true);
});

test("recovers an initial page once with the latest query after a 409", async () => {
  const seen: Array<{ revision: string; cursor: string | undefined }> = [];
  let first = true;
  const pager = createExplorePager<Item>(10, async (query, cursor) => {
    seen.push({ revision: query.revision, cursor });
    if (first) { first = false; throw Object.assign(new Error("stale"), { status: 409 }); }
    return page(["fresh"]);
  });
  const recovered = await pager.load({ revision: "new" });
  assert.equal(recovered?.recovered, true);
  assert.deepEqual(seen, [{ revision: "new", cursor: undefined }, { revision: "new", cursor: undefined }]);
});

test("recovers a later page by restarting from page one", async () => {
  let calls = 0;
  const pager = createExplorePager<Item>(10, async (_query, cursor) => {
    calls++;
    if (calls === 2) throw Object.assign(new Error("stale"), { status: 409 });
    return cursor ? page(["fresh-two"]) : page(["fresh-one"], "fresh-cursor");
  });
  await pager.load({ revision: "new" });
  const recovered = await pager.load({ revision: "new" }, "next");
  assert.equal(recovered?.page, 1);
  assert.equal(recovered?.recovered, true);
  assert.deepEqual(recovered?.items, [{ marketId: "fresh-one" }]);
  assert.equal(calls, 3);
});

test("recovery failure restores the prior cursor cache", async () => {
  let calls = 0;
  const seen: Array<{ revision: string; cursor: string | undefined }> = [];
  const pager = createExplorePager<Item>(10, async (query, cursor) => {
    calls++;
    seen.push({ revision: query.revision, cursor });
    if (calls === 2 || calls === 3) throw Object.assign(new Error("stale"), { status: 409 });
    return cursor ? page(["two"]) : page(["one"], "cursor");
  });
  const first = await pager.load({ revision: "same" });
  await assert.rejects(() => pager.load({ revision: "same" }, "next"), /stale/);
  assert.deepEqual(await pager.load({ revision: "same" }), first);
  assert.equal(calls, 3);
  await pager.load({ revision: "same" }, "next");
  assert.deepEqual(seen[3], { revision: "same", cursor: "cursor" });
});

test("ordinary errors do not trigger recovery", async () => {
  let calls = 0;
  const pager = createExplorePager<Item>(10, async () => { calls++; throw new Error("network"); });
  await assert.rejects(() => pager.load({}), /network/);
  assert.equal(calls, 1);
});

test("ranking revisions keep the current page while other sorts retain reset behavior", async () => {
  const seen: Array<{ revision?: string; cursor?: string }> = [];
  const pager = createExplorePager<Item>(1, async (query, cursor) => {
    seen.push({ revision: query.revision, cursor });
    return cursor ? page(["second"]) : page(["first"], "next");
  });
  await pager.load({ sort: "marketCapUsd_desc", revision: "one" });
  assert.equal((await pager.load({ sort: "marketCapUsd_desc", revision: "one" }, "next"))?.page, 2);
  assert.equal((await pager.load({ sort: "marketCapUsd_desc", revision: "two" }))?.page, 2);
  assert.equal((await pager.load({ sort: "recentBuy_desc", revision: "three" }))?.page, 1);
  assert.deepEqual(seen, [
    { revision: "one", cursor: undefined },
    { revision: "one", cursor: "next" },
    { revision: "three", cursor: undefined },
  ]);
});

test("ranking metadata survives fetch and load", async () => {
  const ranking = { mode: "market-cap-snapshot" as const, version: "v2", updatedAt: "2026-09-15T00:00:00.000Z", refreshSeconds: 1200, stale: false };
  const pager = createExplorePager<Item>(10, async () => ({ ...page(["a"]), ranking }));
  const loaded = await pager.load({ sort: "marketCapUsd_desc" });
  assert.deepEqual(loaded?.ranking, ranking);
});

test("adoptFirstPage only replaces an idle visible first page", async () => {
  const pager = createExplorePager<Item>(10, async () => page(["old"], "next"));
  await pager.load({ sort: "marketCapUsd_desc", revision: "one" });
  assert.equal(pager.adoptFirstPage({ sort: "marketCapUsd_desc", revision: "two" }, { ...page(["new"], "adopt-next"), ranking: { mode: "market-cap-snapshot" as const, version: "3", updatedAt: "now", refreshSeconds: 1200, stale: false } }), true);
  assert.deepEqual((await pager.load({ sort: "marketCapUsd_desc", revision: "two" }))?.items, [{ marketId: "new" }]);
  await pager.load({ sort: "marketCapUsd_desc", revision: "two" }, "next");
  assert.equal(pager.adoptFirstPage({ sort: "marketCapUsd_desc", revision: "three" }, { ...page(["nope"], "next"), ranking: { mode: "market-cap-snapshot" as const, version: "4", updatedAt: "now", refreshSeconds: 1200, stale: false } }), false);
});

test("removeMarkets removes ids from every cached page without changing page number", async () => {
  const pager = createExplorePager<Item>(2, async (_query, cursor) => cursor ? page(["c", "d"]) : page(["a", "b"], "next"));
  await pager.load({ sort: "marketCapUsd_desc" });
  await pager.load({ sort: "marketCapUsd_desc" }, "next");
  pager.removeMarkets(new Set(["a", "c"]));
  assert.deepEqual((await pager.load({ sort: "marketCapUsd_desc" }))?.items, [{ marketId: "d" }]);
  assert.equal((await pager.load({ sort: "marketCapUsd_desc" }, "previous"))?.page, 1);
  assert.deepEqual((await pager.load({ sort: "marketCapUsd_desc" }, "next"))?.items, [{ marketId: "d" }]);
});

test("adoptFirstPage rejects while a page request is in flight", async () => {
  let resolve!: (value: ReturnType<typeof page>) => void;
  const pending = new Promise<ReturnType<typeof page>>(r => { resolve = r; });
  const pager = createExplorePager<Item>(10, async (_query, cursor) => cursor ? pending : page(["first"], "next"));
  await pager.load({ sort: "marketCapUsd_desc" });
  const next = pager.load({ sort: "marketCapUsd_desc" }, "next");
  assert.equal(pager.adoptFirstPage({ sort: "marketCapUsd_desc" }, { ...page(["new"]), ranking: { mode: "market-cap-snapshot" as const, version: "2", updatedAt: "now", refreshSeconds: 1200, stale: false } }), false);
  resolve(page(["second"]));
  await next;
});

test("a superseded 409 request cannot recover or overwrite the newer query", async () => {
  let rejectOld!: (error: unknown) => void;
  const oldRequest = new Promise<never>((_resolve, reject) => { rejectOld = reject; });
  let calls = 0;
  const pager = createExplorePager<Item>(10, async (query) => {
    calls++;
    if (query.id === "old") return oldRequest;
    return page(["new"]);
  });
  const oldLoad = pager.load({ id: "old" });
  const newLoad = pager.load({ id: "new" });
  assert.deepEqual((await newLoad)?.items, [{ marketId: "new" }]);
  rejectOld(Object.assign(new Error("stale"), { status: 409 }));
  assert.equal(await oldLoad, null);
  assert.equal(calls, 2);
});

test("superseding during recovery prevents rollback into the newer query", async () => {
  let rejectRecovery!: (error: unknown) => void;
  let oldCalls = 0;
  const recovery = new Promise<never>((_resolve, reject) => { rejectRecovery = reject; });
  const pager = createExplorePager<Item>(10, async (query) => {
    if (query.id === "old") {
      oldCalls++;
      if (oldCalls === 1) throw Object.assign(new Error("stale"), { status: 409 });
      return recovery;
    }
    return page(["new"]);
  });
  const oldLoad = pager.load({ id: "old" });
  await new Promise(resolve => setImmediate(resolve));
  const newLoad = pager.load({ id: "new" });
  assert.deepEqual((await newLoad)?.items, [{ marketId: "new" }]);
  rejectRecovery(new Error("recovery failed"));
  assert.equal(await oldLoad, null);
  assert.deepEqual((await pager.load({ id: "new" }))?.items, [{ marketId: "new" }]);
});
