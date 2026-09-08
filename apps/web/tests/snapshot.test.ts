import assert from "node:assert/strict";
import { test } from "node:test";
import type { SyncStatus } from "../src/v1/readApi.ts";
import { assertCanonicalSnapshotContinuation, mapConcurrent } from "../src/runtime/snapshot.ts";
const hash = `0x${"aa".repeat(32)}` as const;
const nextHash = `0x${"bb".repeat(32)}` as const;
const sync = (number: number, blockHash = nextHash): SyncStatus => ({ chainId: 4663, status: "synced", finality: "finalized", blockNumber: String(number), blockHash, headBlockNumber: String(number), headBlockHash: blockHash, lagBlocks: "0", revision: `${number}:${blockHash}` });
test("normal finalized progress preserves a canonical original snapshot", async () => {
  let reads = 0;
  await assertCanonicalSnapshotContinuation(sync(101), `100:${hash}`, async (number) => { assert.equal(number, 100n); reads++; return hash; });
  assert.equal(reads, 1);
});
test("regression, reorg and lagging snapshots remain fail closed", async () => {
  await assert.rejects(assertCanonicalSnapshotContinuation(sync(99), `100:${hash}`, async () => hash), /regressed/);
  await assert.rejects(assertCanonicalSnapshotContinuation(sync(101), `100:${hash}`, async () => nextHash), /canonical/);
  await assert.rejects(assertCanonicalSnapshotContinuation({ ...sync(101), status: "lagging" }, `100:${hash}`, async () => hash));
});
test("large metadata collections retain order while bounding concurrent RPC work", async () => {
  let active = 0, peak = 0;
  const items = Array.from({ length: 1601 }, (_, i) => i);
  const result = await mapConcurrent(items, async (item) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--; return item;
  });
  assert.deepEqual(result, items);
  assert.equal(peak, 6);
});
