import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CanonicalReplayEngine, JsonCheckpointStore } from "../src/index.ts";
import { address, block, event, id } from "./fixtures.ts";

test("persists a bigint-safe checkpoint and resumes with byte-identical projections", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "tickergarden-indexer-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new JsonCheckpointStore(path.join(directory, "checkpoint.json"));
  const engine = new CanonicalReplayEngine(4663, 10n, id("anchor"), store);
  const b10 = block(10n, id("10"), id("anchor"), [event(
    "MarketRegistered(bytes32,bytes32,address,address,address,uint32)",
    { marketId: id("20"), assetUid: id("21"), memeToken: address("2"), curve: address("3"), gauge: address("4"), sourceVersion: 1n },
    10n, id("10"),
  )]);
  await engine.acceptBranch([b10]);
  const restored = await CanonicalReplayEngine.restore(store);
  assert.ok(restored);
  assert.equal(restored.canonicalBytes(), engine.canonicalBytes());
  assert.equal(restored.canonicalStateBytes(), engine.canonicalStateBytes());
  assert.equal(restored.tip?.hash, id("10"));
});

test("rolls back to a known common ancestor and equals an empty-database rebuild", async () => {
  const anchor = id("anchor");
  const b10 = block(10n, id("10"), anchor, [event("CurveCompleted(bytes32)", { marketId: id("20") }, 10n, id("10"))]);
  const b11a = block(11n, id("11a"), id("10"), [event(
    "MarketStatusChanged(bytes32,uint8,uint8,bytes32)",
    { marketId: id("20"), oldStatus: 1n, newStatus: 2n, reasonHash: id("a") }, 11n, id("11a"),
  )]);
  const b12a = block(12n, id("12a"), id("11a"), [event("CurveCompleted(bytes32)", { marketId: id("30") }, 12n, id("12a"))]);
  const b11b = block(11n, id("11b"), id("10"), [event(
    "MarketStatusChanged(bytes32,uint8,uint8,bytes32)",
    { marketId: id("20"), oldStatus: 1n, newStatus: 3n, reasonHash: id("b") }, 11n, id("11b"),
  )]);
  const b12b = block(12n, id("12b"), id("11b"), [event("CurveCompleted(bytes32)", { marketId: id("40") }, 12n, id("12b"))]);

  const reorged = new CanonicalReplayEngine(4663, 10n, anchor);
  await reorged.acceptBranch([b10, b11a, b12a]);
  await reorged.acceptBranch([b11b, b12b]);
  const rebuilt = new CanonicalReplayEngine(4663, 10n, anchor);
  await rebuilt.acceptBranch([b10, b11b, b12b]);

  assert.equal(reorged.canonicalStateBytes(), rebuilt.canonicalStateBytes());
  assert.equal(reorged.canonicalBytes(), rebuilt.canonicalBytes());
  assert.equal(reorged.state.markets.has(id("30")), false);
  assert.equal(reorged.state.markets.get(id("20"))?.values.controllerStatus, 3n);
});

test("treats exact block replay as idempotent and rejects payload conflicts or disconnected branches atomically", async () => {
  const engine = new CanonicalReplayEngine(4663, 10n, id("anchor"));
  const b10 = block(10n, id("10"), id("anchor"), [event("CurveCompleted(bytes32)", { marketId: id("20") }, 10n, id("10"))]);
  await engine.acceptBranch([b10]);
  const before = engine.canonicalStateBytes();
  assert.equal(await engine.acceptBranch([b10]), "duplicate");
  const conflict = block(10n, id("10"), id("anchor"), [event("CurveCompleted(bytes32)", { marketId: id("different") }, 10n, id("10"))]);
  await assert.rejects(engine.acceptBranch([conflict]), /payload conflict/);
  const disconnected = block(12n, id("12"), id("unknown"), [event("CurveCompleted(bytes32)", { marketId: id("20") }, 12n, id("12"))]);
  await assert.rejects(engine.acceptBranch([disconnected]), /known common ancestor/);
  assert.equal(engine.canonicalStateBytes(), before);
});

test("reorg removes orphan Swap/Hook fee pairing and fee credit", async () => {
  const engine = new CanonicalReplayEngine(4663, 10n, id("anchor"));
  const poolId = id("70");
  const marketId = id("71");
  const swap = event("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)", {
    id: poolId, sender: address("2"), amount0: -10n, amount1: 9n, sqrtPriceX96: 1n, liquidity: 2n, tick: 3n, fee: 0n,
  }, 10n, id("10"), 0);
  const fee = event("V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)", {
    marketId, poolId, feeAsset: address("3"), feeNonce: 1n, feeId: id("72"), base: 100n,
    totalFee: 10n, lpAmount: 2n, nonLpAmount: 8n,
  }, 10n, id("10"), 1);
  await engine.acceptBranch([block(10n, id("10"), id("anchor"), [swap, fee])]);
  assert.equal(engine.state.feeCredits.size, 1);
  await engine.acceptBranch([block(10n, id("10b"), id("anchor"), [event("CurveCompleted(bytes32)", { marketId }, 10n, id("10b"))])]);
  assert.equal(engine.state.feeCredits.size, 0);
  assert.equal(engine.state.swaps.size, 0);
});
