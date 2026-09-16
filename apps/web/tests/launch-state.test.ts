import assert from "node:assert/strict";
import { test } from "node:test";
import {
  launchPhaseDisplay,
  launchStateKey,
  readLaunchState,
  saveLaunchState,
  type LaunchState,
} from "../src/create/launch-state.ts";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const account = `0x${"11".repeat(20)}`;
const hash = `0x${"22".repeat(32)}`;
const expected = {
  factory: `0x${"33".repeat(20)}`,
  marketId: `0x${"44".repeat(32)}`,
  token: `0x${"55".repeat(20)}`,
  curve: `0x${"66".repeat(20)}`,
  gauge: `0x${"77".repeat(20)}`,
};

function state(chainId = 4663): LaunchState {
  return {
    version: 1,
    id: "launch-1",
    chainId,
    account,
    phase: "confirming",
    detail: "Waiting for confirmation",
    hash,
    intent: "0xintent",
    expected,
  };
}

test("saves and restores an active launch with its transaction hash and identity", () => {
  const store = storage();
  const saved = state();
  saveLaunchState(store, saved);

  assert.deepEqual(readLaunchState(store, saved.chainId), saved);
  assert.equal(store.getItem(launchStateKey(saved.chainId)), JSON.stringify(saved));
});

test("isolates saved launch progress by chain", () => {
  const store = storage();
  const first = state(4663);
  const { hash: _hash, ...withoutHash } = state(1);
  const second = { ...withoutHash, id: "launch-2" };
  saveLaunchState(store, first);
  saveLaunchState(store, second);

  assert.deepEqual(readLaunchState(store, 4663), first);
  assert.deepEqual(readLaunchState(store, 1), second);
  assert.equal(readLaunchState(store, 10), null);
});

test("fails closed for missing, corrupt, and malformed saved progress", () => {
  assert.equal(readLaunchState(storage(), 4663), null);
  assert.throws(
    () => readLaunchState(storage({ [launchStateKey(4663)]: "{not-json" }), 4663),
    SyntaxError,
  );
  assert.throws(
    () => readLaunchState(storage({ [launchStateKey(4663)]: JSON.stringify({ version: 2 }) }), 4663),
    /Saved launch progress is invalid/,
  );
  assert.throws(
    () => readLaunchState(storage({ [launchStateKey(4663)]: JSON.stringify({ ...state(), detail: 42 }) }), 4663),
    /Saved launch progress is invalid/,
  );
});

test("rejects an invalid transaction hash or launch identity", () => {
  const invalidHash = { ...state(), hash: "0x1234" };
  assert.throws(
    () => readLaunchState(storage({ [launchStateKey(4663)]: JSON.stringify(invalidHash) }), 4663),
    /Invalid saved transaction hash/,
  );

  const invalidIdentity = { ...state(), expected: { ...expected, marketId: account } };
  assert.throws(
    () => readLaunchState(storage({ [launchStateKey(4663)]: JSON.stringify(invalidIdentity) }), 4663),
    /Invalid saved launch identity/,
  );
});

test("marks complete progress at 100 percent and every earlier phase below 100", () => {
  assert.equal(launchPhaseDisplay.complete.percent, 100);
  assert.equal(launchPhaseDisplay.complete.step, "Launch complete");
  for (const [phase, display] of Object.entries(launchPhaseDisplay)) {
    if (phase !== "complete") assert.ok(display.percent < 100, `${phase} should not be complete`);
  }
});
