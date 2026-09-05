import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyDeploymentTrack,
  classifyForkTrack,
  classifyProductTrack,
  validateForkSnapshot,
} from "./check-v1-ci-tracks.mjs";

function forkInventory(overrides = {}) {
  return {
    tests: 0,
    testFunctions: 0,
    fixtureFiles: 0,
    fixtureManifest: false,
    fixtureValidator: false,
    fixtureTests: 0,
    fixtureTestFunctions: 0,
    rpcConfigured: false,
    ...overrides,
  };
}

test("empty implementation tracks are explicitly NOT_STARTED", () => {
  assert.equal(
    classifyProductTrack({ sources: 0, tests: 0, testFunctions: 0, missingArtifacts: [] }).state,
    "NOT_STARTED",
  );
  assert.equal(
    classifyForkTrack(forkInventory()).state,
    "NOT_STARTED",
  );
  assert.equal(
    classifyDeploymentTrack({ schemas: 0, schemaSources: 0, schemaTests: 0, preflightSources: 0, preflightTests: 0 }).state,
    "NOT_STARTED",
  );
});

test("a product module without tests fails closed", () => {
  assert.throws(
    () => classifyProductTrack({ sources: 1, tests: 0, testFunctions: 0, missingArtifacts: [] }),
    /without a product test file/,
  );
});

test("product work without compiled artifacts fails closed", () => {
  assert.throws(
    () => classifyProductTrack({ sources: 1, tests: 1, testFunctions: 1, missingArtifacts: ["A.sol"] }),
    /missing compiled artifacts/,
  );
});

test("partial fixture work fails closed", () => {
  assert.throws(
    () => classifyForkTrack(forkInventory({ fixtureFiles: 1 })),
    /v1-fork-fixtures\.json/,
  );
  assert.throws(
    () => classifyForkTrack(forkInventory({ fixtureFiles: 1, fixtureManifest: true })),
    /generate_v1_test_fixtures\.py/,
  );
});

test("complete local fixture layer is active without an RPC", () => {
  assert.equal(
    classifyForkTrack(
      forkInventory({
        fixtureFiles: 1,
        fixtureManifest: true,
        fixtureValidator: true,
        fixtureTests: 1,
        fixtureTestFunctions: 6,
      }),
    ).state,
    "FIXTURES_ACTIVE",
  );
});

test("live fork tests require an RPC after fixtures are complete", () => {
  assert.throws(
    () =>
      classifyForkTrack(
        forkInventory({
          tests: 1,
          testFunctions: 1,
          fixtureFiles: 1,
          fixtureManifest: true,
          fixtureValidator: true,
          fixtureTests: 1,
          fixtureTestFunctions: 6,
        }),
      ),
    /ROBINHOOD_RPC_URL/,
  );
});

test("partial deployment schema work fails closed", () => {
  assert.throws(
    () => classifyDeploymentTrack({ schemas: 1, schemaSources: 0, schemaTests: 0, preflightSources: 0, preflightTests: 0 }),
    /without schema\.ts/,
  );
  assert.throws(
    () => classifyDeploymentTrack({ schemas: 1, schemaSources: 1, schemaTests: 0, preflightSources: 0, preflightTests: 0 }),
    /without schema tests/,
  );
});

test("complete schema work is active without claiming live preflight", () => {
  assert.equal(
    classifyDeploymentTrack({ schemas: 1, schemaSources: 1, schemaTests: 1, preflightSources: 0, preflightTests: 0 }).state,
    "SCHEMA_ACTIVE",
  );
});

test("partial deployment preflight work fails closed", () => {
  assert.throws(
    () => classifyDeploymentTrack({ schemas: 1, schemaSources: 1, schemaTests: 1, preflightSources: 1, preflightTests: 0 }),
    /introduced together/,
  );
});

test("complete inventories activate their tracks", () => {
  assert.equal(
    classifyProductTrack({ sources: 1, tests: 1, testFunctions: 2, missingArtifacts: [] }).state,
    "ACTIVE",
  );
  assert.equal(
    classifyForkTrack(
      forkInventory({
        tests: 1,
        testFunctions: 1,
        fixtureFiles: 1,
        fixtureManifest: true,
        fixtureValidator: true,
        fixtureTests: 1,
        fixtureTestFunctions: 6,
        rpcConfigured: true,
      }),
    ).state,
    "ACTIVE",
  );
  assert.equal(
    classifyDeploymentTrack({ schemas: 1, schemaSources: 1, schemaTests: 1, preflightSources: 1, preflightTests: 1 }).state,
    "ACTIVE",
  );
});

test("fork snapshot validation binds both chain ID and exact block hash", () => {
  const evidence = {
    chainId: 4663,
    blockNumber: "54574453",
    blockHash: "0x890779a9495c5e825a5c19c70d0de3afd3e4076e7da74387346b30bc79460e22",
  };
  validateForkSnapshot({
    evidence,
    chainId: "0x1237",
    block: { number: "0x340bd75", hash: evidence.blockHash },
  });
  assert.throws(
    () =>
      validateForkSnapshot({
        evidence,
        chainId: "0x1237",
        block: { number: "0x340bd75", hash: `0x${"11".repeat(32)}` },
      }),
    /hash mismatch/,
  );
  assert.throws(
    () => validateForkSnapshot({ evidence, chainId: "0xb626", block: null }),
    /chain ID mismatch/,
  );
});

test("root CI keeps live Fork coverage outside contract tests and routes it through the gate runner", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const scripts = packageJson.scripts;

  assert.equal(typeof scripts?.["test:contracts"], "string");
  assert.match(
    scripts["test:contracts"],
    /--no-match-path\s+["']test\/v1\/fork\/\*\*["']/,
  );
  assert.equal(typeof scripts?.test, "string");
  assert.match(scripts.test, /npm run test:ci-gates/);
  assert.equal(typeof scripts?.["test:ci-gates"], "string");
  assert.match(scripts["test:ci-gates"], /npm run check:tracks/);
});
