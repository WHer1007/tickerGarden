import assert from "node:assert/strict";
import { test } from "node:test";
import {
  transactionObservationText,
  validateTransactionObservation,
  mountTransactionObservation,
} from "../src/v1/transactionObservation.ts";

const tx = `0x${"a".repeat(64)}` as `0x${string}`;
const head = `0x${"b".repeat(64)}` as `0x${string}`;
const finalized = `0x${"c".repeat(64)}` as `0x${string}`;
const journal = `0x${"d".repeat(64)}` as `0x${string}`;
const orphan = `0x${"e".repeat(64)}` as `0x${string}`;
const receipt = (execution: "succeeded" | "reverted" = "succeeded") => ({
  blockNumber: "99", transactionIndex: "2", blockHash: journal, execution,
});

function observation(state: "unknown" | "pending" | "confirmed" | "finalized" | "reorged", execution?: "succeeded" | "reverted") {
  const hasReceipt = execution !== undefined;
  return {
    chainId: 4663 as const, transactionHash: tx, state,
    confirmations: hasReceipt ? "2" : "0", receipt: hasReceipt ? receipt(execution) : null,
    orphanedReceipts: state === "reorged" ? [{ ...receipt(), blockHash: orphan }] : [],
    headNumber: "100", headHash: head, finalizedNumber: "98", finalizedHash: finalized,
    source: "indexed_journal_and_rpc" as const, indexedFrom: "1", journalHeadNumber: "100",
    journalHeadHash: head, journalObservedAt: "2026-09-07T00:00:00Z", rpcObservedAt: "2026-09-07T00:00:01Z",
    displayOnly: true as const,
  };
}

test("accepts the five observation states, including a reverted receipt as its own execution result", () => {
  for (const state of ["unknown", "pending", "confirmed", "finalized", "reorged"] as const) {
    const value = state === "finalized"
      ? { ...observation(state, "succeeded"), confirmations: "3", receipt: { ...receipt(), blockNumber: "98", blockHash: finalized } }
      : state === "confirmed" ? observation(state, "succeeded") : observation(state);
    assert.equal(validateTransactionObservation(value, 4663, tx).state, state);
  }
  const reverted = validateTransactionObservation(observation("confirmed", "reverted"), 4663, tx);
  assert.equal(reverted.state, "confirmed");
  assert.equal(reverted.receipt?.execution, "reverted");
  assert.match(transactionObservationText(reverted), /Execution reverted/);
});

test("rejects inconsistent chain, hash, confirmations, finality, and duplicate orphan data", () => {
  const cases = [
    { name: "chain", change: { chainId: 1 } },
    { name: "hash", change: { transactionHash: head } },
    { name: "confirmations", change: { confirmations: "3" } },
    { name: "finality", change: { finalizedNumber: "101" } },
    { name: "duplicate orphan", change: { orphanedReceipts: [{ ...receipt(), blockHash: orphan }, { ...receipt(), blockHash: orphan }] } },
  ];
  for (const { name, change } of cases) {
    assert.throws(() => validateTransactionObservation({ ...observation("unknown"), ...change }, 4663, tx), /inconsistent/, name);
  }
});

test("unknown text does not claim the transaction was dropped", () => {
  const text = transactionObservationText(observation("unknown"));
  assert.match(text, /Not observed/);
  assert.match(text, /does not establish that the transaction was dropped/);
});

test("mount clears on stop and ignores a late failed request", async () => {
  class Node {
    textContent = ""; disabled = false; onclick: (() => void) | null = null;
    children: Node[] = [];
    setAttribute() {}
    append(...nodes: Node[]) { this.children.push(...nodes); }
  }
  const root = new Node();
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = { createElement: () => new Node() } as unknown as Document;
  globalThis.fetch = () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("late")), 5)) as Promise<Response>;
  try {
    const stop = mountTransactionObservation(root as unknown as HTMLElement, "https://example.test", 4663, tx);
    const button = root.children[0]!;
    const status = root.children[1]!;
    button.onclick?.();
    stop();
    assert.equal(status.textContent, "");
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(status.textContent, "");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("a failed refresh replaces the previous observation and a stopped successful request cannot restore it", async () => {
  class Node {
    textContent = ""; disabled = false; onclick: (() => Promise<void>) | null = null;
    children: Node[] = [];
    setAttribute() {}
    append(...nodes: Node[]) { this.children.push(...nodes); }
  }
  const root = new Node();
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = { createElement: () => new Node() } as unknown as Document;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(observation("pending")));
    const stop = mountTransactionObservation(root as unknown as HTMLElement, "https://example.test", 4663, tx);
    const [button, status] = root.children as [Node, Node];
    await button.onclick!();
    assert.match(status.textContent, /Pending/);
    globalThis.fetch = async () => { throw new Error('unavailable'); };
    await button.onclick!();
    assert.match(status.textContent, /unavailable/);
    assert.doesNotMatch(status.textContent, /Pending/);
    let deliver!: (response: Response) => void;
    globalThis.fetch = () => new Promise(resolve => { deliver = resolve; });
    const request = button.onclick!();
    stop();
    deliver(new Response(JSON.stringify(observation("pending"))));
    await request;
    assert.equal(status.textContent, '');
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});
