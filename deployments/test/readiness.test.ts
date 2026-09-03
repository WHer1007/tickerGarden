import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  V2_EXECUTION_SPEC_ID,
  V2_READINESS_STATES,
  assertNoProductionPlaceholders,
  assertV2Deployable,
  assertV2ProductionReady,
  deriveV2ReadinessState,
  findProductionPlaceholderViolations,
  isV2Deployable,
  productionPlaceholderPolicy,
  readinessFlags,
  referenceFixtureValues,
  v2Readiness,
  type V2ReadinessDescriptor,
} from "../src/index.ts";

test("derives all four readiness states only from ordered open gates", () => {
  assert.deepEqual(V2_READINESS_STATES, [
    "SPEC_FROZEN_NOT_DEPLOYABLE",
    "IMPLEMENTATION_ALLOWED",
    "DEPLOYMENT_ELIGIBLE",
    "PRODUCTION_READY",
  ]);
  assert.equal(
    deriveV2ReadinessState({ implementation: ["I"], deployment: ["D"], production: ["P"] }),
    "SPEC_FROZEN_NOT_DEPLOYABLE",
  );
  assert.equal(
    deriveV2ReadinessState({ implementation: [], deployment: ["D"], production: ["P"] }),
    "IMPLEMENTATION_ALLOWED",
  );
  assert.equal(
    deriveV2ReadinessState({ implementation: [], deployment: [], production: ["P"] }),
    "DEPLOYMENT_ELIGIBLE",
  );
  assert.equal(
    deriveV2ReadinessState({ implementation: [], deployment: [], production: [] }),
    "PRODUCTION_READY",
  );
  assert.deepEqual(readinessFlags("DEPLOYMENT_ELIGIBLE"), {
    implementationAllowed: true,
    deploymentEligible: true,
    productionReady: false,
  });
});

test("loads the canonical manifest and remains blocked by deployment gates", () => {
  assert.equal(V2_EXECUTION_SPEC_ID, "V2-EXEC-3");
  assert.equal(v2Readiness.state, "IMPLEMENTATION_ALLOWED");
  assert.equal(v2Readiness.implementationAllowed, true);
  assert.equal(v2Readiness.deploymentEligible, false);
  assert.equal(v2Readiness.productionReady, false);
  assert.deepEqual(v2Readiness.openGates.implementation, []);
  assert.equal(isV2Deployable(), false);
  assert.throws(() => assertV2Deployable(), /deployment gates: V2-DEPLOY-CHAIN-SNAPSHOT-01/);
  assert.throws(() => assertV2ProductionReady(), /production is blocked/);

  const implementationAllowed = {
    executionSpecId: "V2-EXEC-TEST",
    state: "IMPLEMENTATION_ALLOWED",
    implementationAllowed: true,
    deploymentEligible: false,
    productionReady: false,
    openGates: {
      implementation: [],
      deployment: ["DEPLOYMENT-EVIDENCE"],
      production: ["PRODUCTION-EVIDENCE"],
    },
  } satisfies V2ReadinessDescriptor;
  assert.throws(
    () => assertV2Deployable(implementationAllowed),
    /deployment gates: DEPLOYMENT-EVIDENCE/,
  );

  const deploymentEligible = {
    ...implementationAllowed,
    state: "DEPLOYMENT_ELIGIBLE",
    deploymentEligible: true,
    openGates: {
      implementation: [],
      deployment: [],
      production: ["PRODUCTION-EVIDENCE"],
    },
  } satisfies V2ReadinessDescriptor;
  assert.throws(
    () => assertV2ProductionReady(deploymentEligible),
    /production gates: PRODUCTION-EVIDENCE/,
  );
});

test("accepts only explicitly scoped zero sentinels", () => {
  const clean = {
    releaseStatus: "PRODUCTION",
    quoteAssets: [
      {
        assetKind: "NATIVE",
        tokenAddress: "0x0000000000000000000000000000000000000000",
      },
    ],
    marketInitialRuntime: {
      poolId: `0x${"0".repeat(64)}`,
      sweptAt: 0,
      recoveryEpoch: 0,
    },
    poolBindingInitial: { status: 0 },
    modules: [
      {
        address: "0x72f1c5610d245c6fc4758b842f93f0f119a22e3d",
        runtimeCodeHash: "0x836aa117d9309e84ee102fb3e520195fecc5e515ec9e152d301e6033af5b05d9",
      },
    ],
  };
  assert.deepEqual(
    findProductionPlaceholderViolations(
      clean,
      productionPlaceholderPolicy,
      referenceFixtureValues,
    ),
    [],
  );
});

test("rejects empty, draft, zero, low-entropy and reference fixture values", () => {
  const dirty = {
    unset: null,
    emptyText: " ",
    emptyList: [],
    emptyMap: {},
    status: "DRAFT_RELEASE",
    module: "0x0000000000000000000000000000000000000000",
    synthetic: "0x1111111111111111111111111111111111111111",
    copiedFixture: "0x636898801f28fe599d03199d0523e4de70f14e01",
  };
  const violations = findProductionPlaceholderViolations(
    dirty,
    productionPlaceholderPolicy,
    referenceFixtureValues,
  );
  const codes = new Set(violations.map((entry) => entry.code));
  const expectedCodes = [
    "NULL",
    "EMPTY_STRING",
    "EMPTY_ARRAY",
    "EMPTY_OBJECT",
    "PLACEHOLDER_TAG",
    "ZERO_ADDRESS_OR_HASH",
    "LOW_ENTROPY_ADDRESS_OR_HASH",
    "REFERENCE_FIXTURE_VALUE",
  ] as const;
  for (const expected of expectedCodes) {
    assert.ok(codes.has(expected), expected);
  }
  assert.throws(
    () =>
      assertNoProductionPlaceholders(
        dirty,
        productionPlaceholderPolicy,
        referenceFixtureValues,
      ),
    /production manifest contains placeholders/,
  );
});

test("scans every production manifest and forbids early candidates", () => {
  const directory = new URL("../manifests/", import.meta.url);
  const candidates = readdirSync(directory).filter((name) => name.endsWith(".production.json"));
  if (v2Readiness.state === "SPEC_FROZEN_NOT_DEPLOYABLE") {
    assert.deepEqual(candidates, []);
  }
  for (const name of candidates) {
    const candidate = JSON.parse(readFileSync(new URL(name, directory), "utf8")) as unknown;
    assertNoProductionPlaceholders(
      candidate,
      productionPlaceholderPolicy,
      referenceFixtureValues,
    );
  }
});
