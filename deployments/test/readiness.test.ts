import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  V1_EXECUTION_SPEC_ID,
  V1_READINESS_STATES,
  assertNoProductionPlaceholders,
  assertV1Deployable,
  assertV1ProductionReady,
  deriveV1ReadinessState,
  findProductionPlaceholderViolations,
  isV1Deployable,
  productionPlaceholderPolicy,
  readinessFlags,
  referenceFixtureValues,
  v1Readiness,
  type V1ReadinessDescriptor,
} from "../src/index.ts";

test("derives all four readiness states only from ordered open gates", () => {
  assert.deepEqual(V1_READINESS_STATES, [
    "SPEC_FROZEN_NOT_DEPLOYABLE",
    "IMPLEMENTATION_ALLOWED",
    "DEPLOYMENT_ELIGIBLE",
    "PRODUCTION_READY",
  ]);
  assert.equal(
    deriveV1ReadinessState({ implementation: ["I"], deployment: ["D"], production: ["P"] }),
    "SPEC_FROZEN_NOT_DEPLOYABLE",
  );
  assert.equal(
    deriveV1ReadinessState({ implementation: [], deployment: ["D"], production: ["P"] }),
    "IMPLEMENTATION_ALLOWED",
  );
  assert.equal(
    deriveV1ReadinessState({ implementation: [], deployment: [], production: ["P"] }),
    "DEPLOYMENT_ELIGIBLE",
  );
  assert.equal(
    deriveV1ReadinessState({ implementation: [], deployment: [], production: [] }),
    "PRODUCTION_READY",
  );
  assert.deepEqual(readinessFlags("DEPLOYMENT_ELIGIBLE"), {
    implementationAllowed: true,
    deploymentEligible: true,
    productionReady: false,
  });
});

test("loads the canonical manifest and remains blocked by deployment gates", () => {
  assert.equal(V1_EXECUTION_SPEC_ID, "V1-EXEC-9");
  assert.equal(v1Readiness.state, "IMPLEMENTATION_ALLOWED");
  assert.equal(v1Readiness.implementationAllowed, true);
  assert.equal(v1Readiness.deploymentEligible, false);
  assert.equal(v1Readiness.productionReady, false);
  assert.deepEqual(v1Readiness.openGates.implementation, []);
  assert.equal(isV1Deployable(), false);
  assert.throws(() => assertV1Deployable(), /deployment gates: V1-DEPLOY-CHAIN-SNAPSHOT-01/);
  assert.throws(() => assertV1ProductionReady(), /production is blocked/);

  const implementationAllowed = {
    executionSpecId: "V1-EXEC-TEST",
    state: "IMPLEMENTATION_ALLOWED",
    implementationAllowed: true,
    deploymentEligible: false,
    productionReady: false,
    openGates: {
      implementation: [],
      deployment: ["DEPLOYMENT-EVIDENCE"],
      production: ["PRODUCTION-EVIDENCE"],
    },
  } satisfies V1ReadinessDescriptor;
  assert.throws(
    () => assertV1Deployable(implementationAllowed),
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
  } satisfies V1ReadinessDescriptor;
  assert.throws(
    () => assertV1ProductionReady(deploymentEligible),
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
    },
    poolBindingInitial: { status: 0 },
    livePreflight: {
      storageChecks: [
        {
          target: "0x72f1c5610d245c6fc4758b842f93f0f119a22e3d",
          slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
          expectedValue: `0x${"0".repeat(64)}`,
        },
      ],
    },
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

  const unrecognizedZeroSlot = structuredClone(clean);
  unrecognizedZeroSlot.livePreflight.storageChecks[0]!.slot =
    "0x836aa117d9309e84ee102fb3e520195fecc5e515ec9e152d301e6033af5b05d9";
  assert.deepEqual(
    findProductionPlaceholderViolations(
      unrecognizedZeroSlot,
      productionPlaceholderPolicy,
      referenceFixtureValues,
    ).map((violation) => [violation.path, violation.code]),
    [["$.livePreflight.storageChecks.0.expectedValue", "ZERO_ADDRESS_OR_HASH"]],
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
    copiedFixture: "0x0e8cc85e3350d4ca44b42064eb50df2b6ed03fdb",
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
  if (v1Readiness.state === "SPEC_FROZEN_NOT_DEPLOYABLE") {
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
