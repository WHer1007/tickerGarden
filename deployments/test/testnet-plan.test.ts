import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  V1_DEPLOYMENT_CONFIGURATION_INPUTS,
  V1_DEPLOYMENT_GATE_IDS,
  V1_ORDINARY_COMPONENT_ORDER,
  V1_TESTNET_DEPENDENCY_NAMES,
  assertV1TestnetRuntimeObservation,
  assertV1TestnetDeploymentPlanConsistency,
  v1TestnetDeploymentPlan,
  loadV1TestnetDeploymentPlan,
} from "../src/v1/testnet-plan.ts";
import { validateV1TestnetDeploymentPlanSchema } from "../src/schema.ts";

test("accepts the pinned Robinhood Chain testnet deployment plan", () => {
  assert.deepEqual(validateV1TestnetDeploymentPlanSchema(v1TestnetDeploymentPlan), {
    valid: true,
    errors: [],
  });
  assert.doesNotThrow(() => assertV1TestnetDeploymentPlanConsistency(v1TestnetDeploymentPlan));
  assert.equal((v1TestnetDeploymentPlan.chain as Record<string, unknown>).chainId, 46630);
});

test("pins every dependency, deterministic component, and deployment gate exactly once", () => {
  const dependencies = v1TestnetDeploymentPlan.externalDependencies as Array<Record<string, unknown>>;
  const deterministic = v1TestnetDeploymentPlan.deterministicDeployment as Record<string, unknown>;
  const gates = v1TestnetDeploymentPlan.deploymentGateEvidence as Array<Record<string, unknown>>;
  assert.deepEqual(
    new Set(dependencies.map((item) => item.name)),
    new Set(V1_TESTNET_DEPENDENCY_NAMES),
  );
  assert.deepEqual(deterministic.ordinaryComponentOrder, [...V1_ORDINARY_COMPONENT_ORDER]);
  assert.deepEqual(
    new Set(v1TestnetDeploymentPlan.configurationInputs as string[]),
    new Set(V1_DEPLOYMENT_CONFIGURATION_INPUTS),
  );
  assert.deepEqual(new Set(gates.map((item) => item.gateId)), new Set(V1_DEPLOYMENT_GATE_IDS));
});

test("rejects chain drift and gate drift", () => {
  const path = new URL("../manifests/robinhood-testnet-46630.v1.plan.json", import.meta.url);
  const chainDrift = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  (chainDrift.chain as Record<string, unknown>).chainId = 4663;
  assert.equal(validateV1TestnetDeploymentPlanSchema(chainDrift).valid, false);

  const gateDrift = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  ((gateDrift.deploymentGateEvidence as Array<Record<string, unknown>>)[0]!).status = "OPEN";
  assert.throws(() => assertV1TestnetDeploymentPlanConsistency(gateDrift), /gate drift/);
});

test("runtime observation binds exact byte length and Ethereum Keccak codehash", () => {
  const dependency = {
    name: "TEST_RUNTIME",
    runtimeCodeSize: 2,
    runtimeCodeHash: "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
  };
  assert.doesNotThrow(() => assertV1TestnetRuntimeObservation(dependency, "0x6000"));
  assert.throws(
    () => assertV1TestnetRuntimeObservation({ ...dependency, runtimeCodeSize: 1 }, "0x6000"),
    /runtime size drift/,
  );
  assert.throws(
    () => assertV1TestnetRuntimeObservation({ ...dependency, runtimeCodeHash: `0x${"11".repeat(32)}` }, "0x6000"),
    /runtime codehash drift/,
  );
});

test("deterministic deployment exposes a private-key-free preview and binds initial admin", () => {
  const scriptPath = new URL(
    "../../contracts/script/v1/DeployV1Deterministic.s.sol",
    import.meta.url,
  );
  const source = readFileSync(scriptPath, "utf8");
  const preview = source.match(/function preview\(\)[\s\S]*?\n\s*function _prepare\(/)?.[0] ?? "";

  assert.match(source, /function preview\(\) external view returns \(V1DeploymentPlan memory plan\)/);
  assert.match(preview, /_prepare\(vm\.envAddress\("V1_EXPECTED_DEPLOYER"\)\)/);
  assert.doesNotMatch(preview, /DEPLOYER_PRIVATE_KEY/);
  assert.match(source, /_assertAddress\("V1_INITIAL_ADMIN", context\.deployer, config\.initialAdmin\)/);
});

test("deployment script environment names exactly match the testnet configuration contract", () => {
  const scriptPath = new URL(
    "../../contracts/script/v1/DeployV1Deterministic.s.sol",
    import.meta.url,
  );
  const source = readFileSync(scriptPath, "utf8");
  const extracted = [...source.matchAll(/"(DEPLOYER_PRIVATE_KEY|V1_[A-Z0-9_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(extracted)].sort(),
    [...new Set(V1_DEPLOYMENT_CONFIGURATION_INPUTS)].sort(),
  );
});

test("Arbitrum integration is explicit, RH production is fixed, and release gates stay independent", () => {
  const plan = loadV1TestnetDeploymentPlan("arbitrum-sepolia");
  assert.equal((plan.chain as Record<string, unknown>).chainId, 421614);
  assert.equal(plan.productionTargetChainId, 4663);
  assert.ok((plan.deploymentGateEvidence as Array<Record<string, unknown>>).every(gate => gate.status === "OPEN"));
  const wrongChain = structuredClone(plan);
  (wrongChain.chain as Record<string, unknown>).chainId = 46630;
  assert.throws(() => assertV1TestnetDeploymentPlanConsistency(wrongChain));
  const copiedGate = structuredClone(plan);
  (copiedGate.deploymentGateEvidence as Array<Record<string, unknown>>)[0]!.status = "CLOSED";
  assert.throws(() => assertV1TestnetDeploymentPlanConsistency(copiedGate), /gate drift/);
  assert.throws(() => loadV1TestnetDeploymentPlan("arbitrum-one"), /Unsupported/);
});
