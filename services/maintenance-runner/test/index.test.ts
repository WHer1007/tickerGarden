import assert from "node:assert/strict";
import { test } from "node:test";
import { getMaintenanceRunnerDescriptor, MAINTENANCE_RUNNER_DESCRIPTOR, MAINTENANCE_ACTIONS, MaintenanceRunner, MaintenanceTransportError, type RunnerEvent } from "../src/index.ts";

const id = (digit: string) => `0x${digit.repeat(64)}`;

test("declares injected non-privileged boundary", () => {
  assert.deepEqual(getMaintenanceRunnerDescriptor(), {
    executionSpecId: "V1-EXEC-9", status: "active", privileged: false,
    transactionSubmissionImplemented: true, transportInjected: true, signerProvided: false,
    rpcProvided: false, userAssetCustody: false, simulateFirst: true,
    durableIdempotencyLookupRequired: true, ambiguousSubmissionRetry: false,
    operations: ["sweep", "checkpoint", "flush-forfeiture", "settle-rage-quit", "treasury-activate"],
    actions: "sweep/checkpoint/flush-forfeiture/settle-rage-quit/treasury-activate -> fixed module/signature mapping",
  });
  assert.equal(Object.isFrozen(MAINTENANCE_RUNNER_DESCRIPTOR), true);
  assert.deepEqual(MAINTENANCE_ACTIONS.sweep, { targetModule: "PonsCompatibleCurve", signature: "sweepCurveFees()" });
  assert.deepEqual(MAINTENANCE_ACTIONS["flush-forfeiture"], { targetModule: "MemeStockGauge", signature: "flushDeferredForfeiture()" });
  assert.deepEqual(MAINTENANCE_ACTIONS["settle-rage-quit"], { targetModule: "AllocationManager", signature: "settleRageQuitRewards(bytes32,address)" });
  assert.deepEqual(MAINTENANCE_ACTIONS["treasury-activate"], { targetModule: "TreasuryDistributorV1", signature: "activateMarket(bytes32)" });
});

test("builds fixed Treasury activation actions without accepting user calldata", async () => {
  const observed: unknown[] = [];
  let submissions = 0;
  const runner = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate(action) { observed.push(action); return { status: "ready" }; },
    async submit() { submissions += 1; return { txHash: id("c") }; },
  });
  const marketId = id("6");
  const activation = { operation: "treasury-activate" as const, marketId, triggerId: id("2") };
  assert.equal((await runner.run(activation)).status, "submitted");
  assert.deepEqual(observed, [
    { ...activation, targetModule: "TreasuryDistributorV1", signature: "activateMarket(bytes32)" },
  ]);
  assert.equal(submissions, 1);
  assert.throws(
    () => runner.run({ ...activation, calldata: "0xdead" } as never),
    /unknown or missing fields/,
  );
});

test("builds a fixed user-scoped rage-quit settlement action", async () => {
  const user = `0x${"a".repeat(40)}`;
  let observed: unknown;
  const runner = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate(action) { observed = action; return { status: "ready" }; },
    async submit() { return { txHash: id("b") }; },
  });
  const request = { operation: "settle-rage-quit" as const, marketId: id("4"), user, triggerId: id("5") };
  assert.equal((await runner.run(request)).status, "submitted");
  assert.deepEqual(observed, {
    ...request,
    targetModule: "AllocationManager",
    signature: "settleRageQuitRewards(bytes32,address)",
  });
  assert.throws(
    () => runner.run({ ...request, user: user.toUpperCase() }),
    /lowercase canonical address/,
  );
});

test("simulates before submitting and skips completed trigger replays", async () => {
  const calls: string[] = [];
  const runner = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate(action) { calls.push(`simulate:${action.signature}`); return { status: "ready" }; },
    async submit(action, key) { calls.push(`submit:${action.targetModule}:${key}`); return { txHash: id("a") }; },
  });
  const request = { operation: "checkpoint" as const, marketId: id("1"), triggerId: id("a") };
  assert.equal((await runner.run(request)).status, "submitted");
  assert.equal((await runner.run(request)).status, "skipped");
  assert.deepEqual(calls, ["simulate:checkpointActivations()", `submit:MemeStockGauge:checkpoint:${id("1")}:${id("a")}`]);
});

test("allows new trigger and coalesces same-trigger concurrency", async () => {
  let submissions = 0; let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runner = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate(action, key) { assert.equal(action.signature, "activateMarket(bytes32)"); assert.match(key, /^treasury-activate:0x.*:0x/); return { status: "ready" }; },
    async submit() { submissions += 1; await gate; return { txHash: id("b") }; },
  });
  const request = { operation: "treasury-activate" as const, marketId: id("5"), triggerId: id("d") };
  const first = runner.run(request); const second = runner.run(request); release();
  assert.equal((await first).status, "submitted"); assert.equal((await second).status, "submitted");
  assert.equal((await runner.run({ ...request, triggerId: id("e") })).status, "submitted");
  assert.equal(submissions, 2);
});

test("classifies noop, fatal, and retryable outcomes", async () => {
  let submits = 0;
  const runner = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate(action) {
      if (action.operation === "checkpoint") return { status: "noop", reason: "nothing" };
      if (action.operation === "sweep") return { status: "fatal", reason: "closed" };
      return submits++ === 0 ? { status: "retryable", reason: "rpc" } : { status: "ready" };
    },
    async submit() { submits += 1; return { txHash: id("f") }; },
  }, { maxAttempts: 3 });
  assert.equal((await runner.run({ operation: "checkpoint", marketId: id("1"), triggerId: id("1") })).status, "skipped");
  assert.equal((await runner.run({ operation: "sweep", marketId: id("2"), triggerId: id("2") })).status, "failed");
  assert.equal((await runner.run({ operation: "treasury-activate", marketId: id("3"), triggerId: id("3") })).status, "submitted");
  assert.equal(submits, 3);
});

test("does not retry deterministic submission failures and isolates observers", async () => {
  let submissions = 0;
  const runner = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate() { return { status: "ready" }; },
    async submit() { submissions += 1; throw new MaintenanceTransportError("bad calldata", false); },
  }, { maxAttempts: 3, onEvent: () => { throw new Error("observer failed"); } });
  const result = await runner.run({ operation: "treasury-activate", marketId: id("4"), triggerId: id("4") });
  assert.equal(result.reason, "bad calldata"); assert.equal(submissions, 1);
  assert.throws(() => runner.run({ operation: "treasury-activate", marketId: "0xABC", triggerId: id("5") }), /canonical bytes32/);
});

test("runMany respects bounded concurrency", async () => {
  let active = 0; let peak = 0;
  const runner = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate() { active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1; return { status: "ready" }; },
    async submit() { active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1; return { txHash: id("c") }; },
  });
  const results = await runner.runMany(Array.from({ length: 8 }, (_, index) => ({ operation: "sweep" as const, marketId: id(index.toString()), triggerId: id("a") })), { concurrency: 2 });
  assert.equal(results.length, 8); assert.ok(peak <= 2);
  await assert.rejects(() => runner.runMany([], { concurrency: 17 }), /concurrency/);
});

test("bounds completed and event buffers by evicting oldest entries", async () => {
  let submits = 0;
  const runner = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate() { return { status: "noop", reason: "nothing" }; },
    async submit() { submits += 1; return { txHash: id("a") }; },
  }, { completedCacheSize: 2, eventBufferSize: 3 });
  for (const digit of ["1", "2", "3"]) {
    await runner.run({ operation: "checkpoint", marketId: id(digit), triggerId: id(digit) });
  }
  assert.equal(submits, 0);
  assert.equal(runner.events.length, 3);
  assert.equal(runner.events[0]?.marketId, id("2"));
  await runner.run({ operation: "checkpoint", marketId: id("1"), triggerId: id("1") });
  assert.equal(runner.events.length, 3);
});

test("fails closed for invalid simulation and submission responses without unsafe retries", async () => {
  let simulations = 0;
  for (const response of [null, undefined, "invalid", 42, { status: "mystery" }, {}]) {
    let submissions = 0;
    const runner = new MaintenanceRunner({
      async findSubmission() { return null; },
      async simulate() { simulations += 1; return response as never; },
      async submit() { submissions += 1; throw new Error("must not submit"); },
    });
    const result = await runner.run({ operation: "sweep", marketId: id("7"), triggerId: id("7") });
    assert.equal(result.status, "failed");
    assert.equal(result.attempt, 1);
    assert.equal(typeof result.reason, "string");
    assert.notEqual(result.reason, "");
    assert.equal(submissions, 0);
  }
  assert.equal(simulations, 6);
  for (const response of [undefined, null, "invalid", {}, { txHash: 42 }, { txHash: "0x12" }]) {
    simulations = 0;
    let submissions = 0;
    const invalidSubmission = new MaintenanceRunner({
      async findSubmission() { return null; },
      async simulate() { simulations += 1; return { status: "ready" }; },
      async submit() { submissions += 1; return response as never; },
    }, { maxAttempts: 3 });
    const invalidResult = await invalidSubmission.run({ operation: "sweep", marketId: id("8"), triggerId: id("8") });
    assert.equal(invalidResult.status, "failed");
    assert.equal(invalidResult.reason, "transport returned an invalid submission response");
    assert.equal(invalidResult.attempt, 1);
    assert.equal(simulations, 1);
    assert.equal(submissions, 1);
  }
});

test("durable lookup prevents replay after cache eviction and process restart", async () => {
  const durable = new Map<string, { txHash: string }>();
  let submissions = 0;
  const transport = {
    async findSubmission(key: string) { return durable.get(key) ?? null; },
    async simulate() { return { status: "ready" as const }; },
    async submit(_action: unknown, key: string) {
      submissions += 1;
      const result = { txHash: id(String(submissions)) };
      durable.set(key, result);
      return result;
    },
  };
  const first = new MaintenanceRunner(transport, { completedCacheSize: 1 });
  const requestA = { operation: "sweep" as const, marketId: id("1"), triggerId: id("a") };
  const requestB = { operation: "sweep" as const, marketId: id("2"), triggerId: id("b") };
  assert.equal((await first.run(requestA)).status, "submitted");
  assert.equal((await first.run(requestB)).status, "submitted");
  assert.equal((await first.run(requestA)).txHash, id("1"));
  assert.equal(submissions, 2);
  assert.equal(first.events.at(-1)?.kind, "recovered");

  const restarted = new MaintenanceRunner(transport);
  assert.equal((await restarted.run(requestA)).txHash, id("1"));
  assert.equal(submissions, 2);
});

test("ambiguous submission recovers its durable hash or stops without a second broadcast", async () => {
  let lookupAttempts = 0;
  let simulations = 0;
  let preBroadcastSubmissions = 0;
  const preBroadcastRetry = new MaintenanceRunner({
    async findSubmission() {
      lookupAttempts += 1;
      throw new MaintenanceTransportError("temporary durable store outage", true);
    },
    async simulate() { simulations += 1; return { status: "ready" }; },
    async submit() { preBroadcastSubmissions += 1; return { txHash: id("z") }; },
  }, { maxAttempts: 3 });
  const preBroadcastResult = await preBroadcastRetry.run({ operation: "treasury-activate", marketId: id("3"), triggerId: id("b") });
  assert.equal(preBroadcastResult.status, "failed");
  assert.equal(preBroadcastResult.attempt, 3);
  assert.match(preBroadcastResult.reason ?? "", /temporary durable store outage/);
  assert.equal(lookupAttempts, 3);
  assert.equal(simulations, 0);
  assert.equal(preBroadcastSubmissions, 0);

  let recoveringLookups = 0;
  let recoveringSubmissions = 0;
  const lookupRecovers = new MaintenanceRunner({
    async findSubmission() {
      recoveringLookups += 1;
      if (recoveringLookups < 3) throw new MaintenanceTransportError("temporary durable store outage", true);
      return null;
    },
    async simulate() { return { status: "ready" }; },
    async submit() { recoveringSubmissions += 1; return { txHash: id("b") }; },
  }, { maxAttempts: 3 });
  const lookupRecoveryResult = await lookupRecovers.run({ operation: "treasury-activate", marketId: id("3"), triggerId: id("f") });
  assert.equal(lookupRecoveryResult.status, "submitted");
  assert.equal(lookupRecoveryResult.attempt, 3);
  assert.equal(recoveringLookups, 3);
  assert.equal(recoveringSubmissions, 1);

  let nonRetryableLookups = 0;
  const nonRetryableLookup = new MaintenanceRunner({
    async findSubmission() {
      nonRetryableLookups += 1;
      throw new Error("durable store rejected request");
    },
    async simulate() { throw new Error("must not simulate"); },
    async submit() { throw new Error("must not submit"); },
  }, { maxAttempts: 3 });
  const nonRetryableResult = await nonRetryableLookup.run({ operation: "treasury-activate", marketId: id("3"), triggerId: id("a") });
  assert.equal(nonRetryableResult.status, "failed");
  assert.equal(nonRetryableResult.attempt, 1);
  assert.equal(nonRetryableLookups, 1);

  const durable = new Map<string, { txHash: string }>();
  let submissions = 0;
  const recovered = new MaintenanceRunner({
    async findSubmission(key) { return durable.get(key) ?? null; },
    async simulate() { return { status: "ready" }; },
    async submit(_action, key) {
      submissions += 1;
      durable.set(key, { txHash: id("c") });
      throw new Error("response lost after broadcast");
    },
  }, { maxAttempts: 3 });
  const request = { operation: "treasury-activate" as const, marketId: id("3"), triggerId: id("c") };
  assert.equal((await recovered.run(request)).txHash, id("c"));
  assert.equal(submissions, 1);

  const unresolved = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate() { return { status: "ready" }; },
    async submit() { submissions += 1; throw new Error("unknown submit outcome"); },
  }, { maxAttempts: 3 });
  const result = await unresolved.run({ ...request, triggerId: id("d") });
  assert.equal(result.status, "failed");
  assert.equal(result.attempt, 1);
  assert.equal(submissions, 2);

  let postBroadcastLookups = 0;
  let postBroadcastSubmissions = 0;
  const postBroadcastLookupFailure = new MaintenanceRunner({
    async findSubmission() {
      postBroadcastLookups += 1;
      if (postBroadcastLookups === 1) return null;
      throw new MaintenanceTransportError("durable store unavailable", true);
    },
    async simulate() { return { status: "ready" }; },
    async submit() {
      postBroadcastSubmissions += 1;
      throw new Error("response lost after broadcast");
    },
  }, { maxAttempts: 3 });
  const postBroadcastResult = await postBroadcastLookupFailure.run({ ...request, triggerId: id("e") });
  assert.equal(postBroadcastResult.status, "failed");
  assert.equal(postBroadcastResult.attempt, 1);
  assert.match(postBroadcastResult.reason ?? "", /durable store unavailable/);
  assert.equal(postBroadcastLookups, 2);
  assert.equal(postBroadcastSubmissions, 1);
});

test("rejects extra request fields and hostile response shapes without exposing event storage", async () => {
  let submissions = 0;
  const hostile = new Proxy({}, { get() { throw new Error("getter trap"); } });
  const runner = new MaintenanceRunner({
    async findSubmission() { return null; },
    async simulate() { return hostile as never; },
    async submit() { submissions += 1; return { txHash: id("e") }; },
  }, { eventBufferSize: 2 });
  assert.throws(
    () => runner.run({ operation: "sweep", marketId: id("4"), triggerId: id("e"), calldata: "0xdead" } as never),
    /unknown or missing fields/,
  );
  const result = await runner.run({ operation: "sweep", marketId: id("4"), triggerId: id("e") });
  assert.equal(result.status, "failed");
  assert.equal(result.attempt, 1);
  assert.equal(submissions, 0);
  const exposed = runner.events as RunnerEvent[];
  assert.throws(() => exposed.push(exposed[0]!), TypeError);
  assert.equal(runner.events.length, 2);
});
