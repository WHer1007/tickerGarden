import assert from "node:assert/strict";
import { test } from "node:test";
import { mountUserActivity } from "../src/v1/userActivityWidget.ts";
import { validateUserActivity } from "../src/v1/userActivity.ts";

const accountA = `0x${"a".repeat(40)}` as `0x${string}`;
const accountB = `0x${"b".repeat(40)}` as `0x${string}`;
const hash = (letter: string) => `0x${letter.repeat(64)}` as `0x${string}`;

function record(account: `0x${string}`, block: string, letter: string, roles = ["caller"] as string[]) {
  const blockHash = hash(letter);
  const transactionHash = hash(String.fromCharCode(letter.charCodeAt(0) + 1));
  return {
    id: `4663:${blockHash}:${transactionHash}:0:${account}`,
    chainId: 4663 as const, account, roles,
    identityBasis: "event_address_reference_not_verified_initiator" as const,
    module: "TickerGarden", signature: "stake(uint256)", emitter: account,
    blockNumber: block, blockHash, transactionHash, transactionIndex: "0", logIndex: "0",
    arguments: { [roles[0]!]: account, amount: "10" },
  };
}

function page(account: `0x${string}`, items = [record(account, "10", "a")], nextCursor: string | null = "next") {
  return {
    chainId: 4663 as const, account, items, nextCursor, indexedFrom: "1", sourceBlockNumber: "10",
    sourceBlockHash: hash("a"), revision: `sha256:${"c".repeat(64)}`,
    finality: "finalized" as const, observedAt: "2026-09-07T00:00:00Z", displayOnly: true as const,
  };
}

test("validates chain/account/id, descending order, duplicates, roles, and pagination revision", () => {
  const first = page(accountA, [record(accountA, "10", "a"), record(accountA, "9", "b")]);
  assert.equal(validateUserActivity(first, 4663, accountA, 50), first);
  for (const change of [
    { chainId: 1 }, { account: accountB },
    { items: [{ ...first.items[0], id: "wrong" }] },
    { items: [first.items[1], first.items[0]] },
    { items: [first.items[0], first.items[0]] },
    { items: [{ ...first.items[0], arguments: { caller: accountB, amount: "10" } }] },
    { items: [{ ...first.items[0], roles: ["z", "a"], arguments: { z: accountA, a: accountA } }] },
  ]) assert.throws(() => validateUserActivity({ ...first, ...change }, 4663, accountA, 50), /inconsistent/);
  const next = page(accountA, [record(accountA, "8", "c")], null);
  assert.equal(validateUserActivity(next, 4663, accountA, 50, first), next);
  assert.throws(() => validateUserActivity({ ...next, revision: `sha256:${"d".repeat(64)}` }, 4663, accountA, 50, first), /inconsistent/);
});

class Node {
  textContent = ""; disabled = false; hidden = false; type = ""; className = "";
  onclick: (() => void) | null = null; children: Node[] = []; attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(...nodes: Node[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Node[]) { this.children = nodes; }
}

function installDom(fetcher: typeof fetch) {
  const oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  globalThis.document = { createElement: () => new Node() } as unknown as Document;
  globalThis.fetch = fetcher;
  return () => { globalThis.document = oldDocument; globalThis.fetch = oldFetch; };
}

test("late wallet A response cannot overwrite wallet B", async () => {
  const pending = new Map<string, (response: Response) => void>();
  const restore = installDom((input) => new Promise<Response>(resolve => {
    const address = new URL(String(input)).pathname.split("/")[3]!; pending.set(address, resolve);
  }));
  try {
    const root = new Node(); const widget = mountUserActivity(root as unknown as HTMLElement, "https://example.test", 4663);
    widget.setContext(accountA, true); widget.setContext(accountB, true);
    pending.get(accountB)!(new Response(JSON.stringify(page(accountB, [record(accountB, "10", "a")], null))));
    await new Promise(resolve => setTimeout(resolve, 0));
    pending.get(accountA)!(new Response(JSON.stringify(page(accountA, [record(accountA, "10", "a")], null))));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(root.children[0]!.textContent, new RegExp(accountB));
    widget.stop();
  } finally { restore(); }
});

test("409 clears the old list and stop blocks a late response", async () => {
  let resolve!: (response: Response) => void; let calls = 0;
  const restore = installDom(() => { calls++; return calls === 1
    ? Promise.resolve(new Response(JSON.stringify(page(accountA, [record(accountA, "10", "a")], null))) )
    : new Promise<Response>(r => { resolve = r; }); });
  try {
    const root = new Node(); const widget = mountUserActivity(root as unknown as HTMLElement, "https://example.test", 4663);
    widget.setContext(accountA, true); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(root.children[1]!.children.length, 1);
    (root.children[2]!.children[0]!.onclick as (() => void))(); await new Promise(resolve => setTimeout(resolve, 0));
    resolve(new Response(JSON.stringify({ error: "activity_page_changed", message: "changed", requestId: "r" }), { status: 409 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(root.children[1]!.children.length, 0); assert.match(root.children[0]!.textContent, /History changed/);
    (root.children[2]!.children[0]!.onclick as (() => void))(); widget.stop();
    resolve(new Response(JSON.stringify(page(accountA)))); await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(root.children[0]!.textContent, /Activity paused/); assert.equal(root.children[1]!.children.length, 0);
  } finally { restore(); }
});


class Timers {
  next = 0; jobs = new Map<number, { callback: () => void; ms: number }>();
  set(callback: () => void, ms: number) { const id = ++this.next; this.jobs.set(id, { callback, ms }); return id; }
  clear(handle: unknown) { this.jobs.delete(handle as number); }
  fire(ms: number) { const job = [...this.jobs].find(([, value]) => value.ms === ms); assert.ok(job, `missing ${ms}ms timer`); this.jobs.delete(job[0]); job[1].callback(); }
  delays() { return [...this.jobs.values()].map(value => value.ms); }
}
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

test("activity polling preserves pagination, replaces changed history and backs off on failures", async () => {
  const timers = new Timers(); let calls = 0;
  const first = page(accountA), second = page(accountA, [record(accountA, "9", "b")], null);
  let response = () => new Response(JSON.stringify(first));
  const restore = installDom(() => { calls++; return Promise.resolve(response()); });
  const root = new Node(); const widget = mountUserActivity(root as unknown as HTMLElement, "https://example.test", 4663, timers);
  try {
    widget.setContext(accountA, true); await settled();
    assert.deepEqual(timers.delays(), [30000]);
    response = () => new Response(JSON.stringify(second));
    root.children[2]!.children[1]!.onclick!(); await settled();
    assert.equal(root.children[1]!.children.length, 2);
    const card = root.children[1]!.children[0];
    response = () => new Response(JSON.stringify(Object.fromEntries(Object.entries({ ...first, observedAt: "2026-09-07T00:00:01Z" }).reverse())));
    timers.fire(30000); await settled();
    assert.equal(root.children[1]!.children.length, 2);
    assert.equal(root.children[1]!.children[0], card, "unchanged history must not rebuild cards or collapse details");
    const changed = { ...page(accountA, [record(accountA, "11", "c")], null), sourceBlockNumber: "11", sourceBlockHash: hash("c"), revision: `sha256:${"d".repeat(64)}` };
    response = () => new Response(JSON.stringify(changed));
    timers.fire(30000); await settled();
    assert.equal(root.children[1]!.children.length, 1);
    assert.match(root.children[0]!.textContent, /1–11/);
    response = () => new Response("unavailable", { status: 503 });
    timers.fire(30000); await settled();
    assert.equal(root.children[1]!.children.length, 0); assert.deepEqual(timers.delays(), [60000]);
    timers.fire(60000); await settled(); assert.deepEqual(timers.delays(), [120000]);
    response = () => new Response(JSON.stringify(changed));
    timers.fire(120000); await settled(); assert.deepEqual(timers.delays(), [30000]);
    assert.equal(root.children[1]!.children.length, 1);
    assert.equal(calls, 7);
    widget.setContext(accountA, false); assert.equal(timers.jobs.size, 0);
    widget.setContext(accountA, true); await settled(); assert.equal(calls, 8);
  } finally { widget.stop(); restore(); }
});

test("activity polling rejects changed content under an unchanged revision", async () => {
  const timers = new Timers(); let altered = false;
  const restore = installDom(() => Promise.resolve(new Response(JSON.stringify(page(accountA, [{ ...record(accountA, "10", "a"), arguments: { caller: accountA, amount: altered ? "11" : "10" } }])))));
  const root = new Node(); const widget = mountUserActivity(root as unknown as HTMLElement, "https://example.test", 4663, timers);
  try {
    widget.setContext(accountA, true); await settled(); altered = true;
    timers.fire(30000); await settled();
    assert.equal(root.children[1]!.children.length, 0); assert.match(root.children[0]!.textContent, /unavailable/);
    assert.deepEqual(timers.delays(), [60000]);
  } finally { widget.stop(); restore(); }
});


test("activity timeout releases a stalled request and ignores its late response", async () => {
  const timers = new Timers(); let resolve!: (response: Response) => void; let calls = 0;
  const restore = installDom(() => { calls++; return calls === 1 ? new Promise<Response>(r => { resolve = r; }) : Promise.resolve(new Response(JSON.stringify(page(accountA)))); });
  const root = new Node(); const widget = mountUserActivity(root as unknown as HTMLElement, "https://example.test", 4663, timers);
  try {
    widget.setContext(accountA, true); assert.deepEqual(timers.delays(), [10000]);
    widget.refresh(); assert.equal(calls, 1, "refresh must coalesce with the current read");
    timers.fire(10000); await settled();
    assert.match(root.children[0]!.textContent, /unavailable/); assert.deepEqual(timers.delays(), [60000]);
    timers.fire(60000); await settled(); assert.equal(calls, 2);
    assert.equal(root.children[1]!.children.length, 1);
    resolve(new Response(JSON.stringify(page(accountB)))); await settled();
    assert.match(root.children[0]!.textContent, new RegExp(accountA));
    widget.stop(); assert.equal(timers.jobs.size, 0);
  } finally { widget.stop(); restore(); }
});
