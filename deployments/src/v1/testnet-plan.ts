import { keccak_256 } from "@noble/hashes/sha3.js";
import { readFileSync } from "node:fs";

import { assertV1TestnetDeploymentPlanSchema } from "../schema.ts";

type JsonRecord = Record<string, unknown>;

export interface V1TestnetReadOnlyRpc {
  request(method: string, params: readonly unknown[]): Promise<unknown>;
}

export type V1TestnetPlanLiveReport = Readonly<{
  chainId: number;
  pinnedLatestBlock: string;
  pinnedFinalizedBlock: string;
  currentLatestBlock: string;
  currentFinalizedBlock: string;
  dependenciesChecked: number;
  positionManagerBindingsChecked: number;
  stateReadTag: "latest";
}>;

export const V1_DEPLOYMENT_GATE_IDS = [
  "V1-DEPLOY-CHAIN-SNAPSHOT-01",
  "V1-DEPLOY-ARTIFACT-CODEHASH-01",
  "V1-DEPLOY-CREATE2-VECTORS-01",
  "V1-DEPLOY-HOOK-MASK-01",
  "V1-DEPLOY-PERMISSIONS-01",
  "V1-DEPLOY-ABI-DIFF-01",
  "V1-DEPLOY-PRODUCT-FORK-E2E-01",
] as const;

export const V1_TESTNET_DEPENDENCY_NAMES = [
  "CANONICAL_CREATE2_DEPLOYER",
  "POOL_MANAGER",
  "POSITION_MANAGER",
  "PERMIT2",
  "UNIVERSAL_ROUTER",
  "V4_QUOTER",
  "STATE_VIEW",
] as const;

export const V1_ORDINARY_COMPONENT_ORDER = [
  "AccessManager",
  "OfficialStockRegistryV1",
  "ApprovedQuoteRegistry",
  "TickerGardenBaselineRegistry",
  "LaunchTemplateRegistry",
  "LaunchConfigResolver",
  "TickerMemeTokenV1Implementation",
  "TickerGardenCurveImplementation",
  "MemeStockGauge",
  "LaunchAndBuyRouter",
  "MarketRegistryV1",
  "CreatorRevenueRegistry",
  "AllocationManager",
  "UserStockVault",
  "HolderRewardsDistributorV1",
  "ProtocolFeeVault",
] as const;

export const V1_BASE_DEPLOYMENT_CONFIGURATION_INPUTS = [
  "DEPLOYER_PRIVATE_KEY",
  "V1_EXPECTED_DEPLOYER",
  "V1_EXPECTED_CHAIN_ID",
  "V1_RELEASE_ID",
  "V1_EXPECTED_ORCHESTRATOR",
  "V1_INITIAL_ADMIN",
  "V1_POOL_MANAGER",
  "V1_POOL_MANAGER_CODEHASH",
  "V1_POSITION_MANAGER",
  "V1_POSITION_MANAGER_CODEHASH",
  "V1_PERMIT2",
  "V1_PERMIT2_CODEHASH",
  "V1_PLATFORM_TREASURY",
  "V1_PLATFORM_TREASURY_CODEHASH",
  "V1_FEE_POLICY_ID",
] as const;

export const V1_DEPLOYMENT_CONFIGURATION_INPUTS = [
  ...V1_BASE_DEPLOYMENT_CONFIGURATION_INPUTS,
  "V1_DEPLOYMENT_HOLDER_MODE",
] as const;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid V1 testnet deployment plan object: ${label}`);
  }
  return value as JsonRecord;
}

function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error(`Invalid V1 testnet deployment plan array: ${label}`);
  return value.map((item, index) => record(item, `${label}.${index}`));
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid V1 testnet deployment plan string array: ${label}`);
  }
  return value as string[];
}

function exactSet(actual: string[], expected: readonly string[], label: string): void {
  if (actual.length !== expected.length || new Set(actual).size !== expected.length) {
    throw new Error(`Invalid V1 testnet deployment plan cardinality: ${label}`);
  }
  const expectedSet = new Set(expected);
  if (actual.some((item) => !expectedSet.has(item as never))) {
    throw new Error(`Invalid V1 testnet deployment plan membership: ${label}`);
  }
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid V1 testnet deployment plan string: ${label}`);
  }
  return value;
}

function decimalBlockTag(value: unknown, label: string): string {
  const decimal = stringField(value, label);
  if (!/^(0|[1-9][0-9]*)$/.test(decimal)) {
    throw new Error(`Invalid V1 testnet deployment plan block: ${label}`);
  }
  return `0x${BigInt(decimal).toString(16)}`;
}

function normalizedData(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`Invalid V1 testnet RPC data: ${label}`);
  }
  return value.toLowerCase();
}

function keccakRuntime(runtime: string): string {
  const bytes = Uint8Array.from(runtime.slice(2).match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  return `0x${Buffer.from(keccak_256(bytes)).toString("hex")}`;
}

function selector(signature: string): string {
  return `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature))).subarray(0, 4).toString("hex")}`;
}

function addressResult(value: unknown, label: string): string {
  const data = normalizedData(value, label);
  if (data.length !== 66 || data.slice(2, 26) !== "0".repeat(24)) {
    throw new Error(`Invalid V1 testnet address result: ${label}`);
  }
  return `0x${data.slice(-40)}`;
}

function assertBlockSnapshot(observed: unknown, snapshot: JsonRecord, label: string): void {
  const block = record(observed, label);
  const expectedNumber = decimalBlockTag(snapshot.number, `${label}.number`);
  const expectedHash = stringField(snapshot.hash, `${label}.hash`).toLowerCase();
  if (
    stringField(block.number, `${label}.observed.number`).toLowerCase() !== expectedNumber ||
    stringField(block.hash, `${label}.observed.hash`).toLowerCase() !== expectedHash
  ) {
    throw new Error(`V1 testnet block snapshot drift: ${label}`);
  }
}

export function assertV1TestnetRuntimeObservation(dependency: JsonRecord, runtimeValue: unknown): void {
  const name = stringField(dependency.name, "dependency.name");
  const runtime = normalizedData(runtimeValue, `${name}.runtime`);
  const expectedBytes = dependency.runtimeCodeSize;
  if (typeof expectedBytes !== "number" || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error(`Invalid V1 testnet runtime size: ${name}`);
  }
  if ((runtime.length - 2) / 2 !== expectedBytes) {
    throw new Error(`V1 testnet runtime size drift: ${name}`);
  }
  if (keccakRuntime(runtime) !== stringField(dependency.runtimeCodeHash, `${name}.runtimeCodeHash`).toLowerCase()) {
    throw new Error(`V1 testnet runtime codehash drift: ${name}`);
  }
}

export function assertV1TestnetDeploymentPlanConsistency(value: unknown): void {
  assertV1TestnetDeploymentPlanSchema(value);
  const plan = record(value, "root");
  const executionManifest = record(
    JSON.parse(
      readFileSync(new URL("../../../spec/v1_execution_manifest.json", import.meta.url), "utf8"),
    ) as unknown,
    "executionManifest",
  );
  const readiness = record(executionManifest.readiness, "executionManifest.readiness");
  const gateSets = record(readiness.gateSets, "executionManifest.readiness.gateSets");
  const deployment = record(gateSets.deployment, "executionManifest.readiness.gateSets.deployment");
  // Arbitrum integration has its own unclosed release gates; RH eligibility is not transferable.
  const openGateIds = new Set(plan.target === "ARBITRUM_SEPOLIA_V4_INTEGRATION"
    ? V1_DEPLOYMENT_GATE_IDS : strings(deployment.open, "deployment.open"));

  const dependencies = records(plan.externalDependencies, "externalDependencies");
  exactSet(
    dependencies.map((item) => String(item.name)),
    V1_TESTNET_DEPENDENCY_NAMES,
    "externalDependencies.name",
  );

  const deterministic = record(plan.deterministicDeployment, "deterministicDeployment");
  const componentOrder = strings(deterministic.ordinaryComponentOrder, "ordinaryComponentOrder");
  if (componentOrder.some((item, index) => item !== V1_ORDINARY_COMPONENT_ORDER[index])) {
    throw new Error("Invalid V1 deterministic ordinary component order");
  }
  const inputs = strings(plan.configurationInputs, "configurationInputs");
  exactSet(
    inputs,
    V1_DEPLOYMENT_CONFIGURATION_INPUTS,
    "configurationInputs",
  );

  const gates = records(plan.deploymentGateEvidence, "deploymentGateEvidence");
  exactSet(
    gates.map((item) => String(item.gateId)),
    V1_DEPLOYMENT_GATE_IDS,
    "deploymentGateEvidence.gateId",
  );
  for (const gate of gates) {
    const gateId = String(gate.gateId);
    const expectedStatus = openGateIds.has(gateId) ? "OPEN" : "CLOSED";
    if (gate.status !== expectedStatus) {
      throw new Error(`V1 testnet plan gate drift: ${gateId} expected ${expectedStatus}`);
    }
  }

  const forkEvidence = record(plan.forkEvidence, "forkEvidence");
  const expectedForkStatus = new Set(strings(deployment.open, "deployment.open")).has("V1-DEPLOY-PRODUCT-FORK-E2E-01") ? "OPEN" : "PASSED";
  if (forkEvidence.status !== expectedForkStatus) {
    throw new Error(`V1 testnet plan fork evidence drift: expected ${expectedForkStatus}`);
  }
}

export async function verifyV1TestnetDeploymentPlanLive(
  value: unknown,
  rpc: V1TestnetReadOnlyRpc,
): Promise<V1TestnetPlanLiveReport> {
  assertV1TestnetDeploymentPlanConsistency(value);
  const plan = record(value, "root");
  const chain = record(plan.chain, "chain");
  const expectedChainId = chain.chainId;
  if (typeof expectedChainId !== "number") throw new Error("Invalid V1 testnet chain ID");
  const observedChainId = stringField(await rpc.request("eth_chainId", []), "eth_chainId");
  if (BigInt(observedChainId) !== BigInt(expectedChainId)) {
    throw new Error(`V1 testnet chain ID drift: expected ${expectedChainId}`);
  }

  const latestSnapshot = record(chain.latestSnapshot, "chain.latestSnapshot");
  const finalizedSnapshot = record(chain.finalizedSnapshot, "chain.finalizedSnapshot");
  assertBlockSnapshot(
    await rpc.request("eth_getBlockByNumber", [decimalBlockTag(latestSnapshot.number, "latestSnapshot.number"), false]),
    latestSnapshot,
    "latestSnapshot",
  );
  assertBlockSnapshot(
    await rpc.request("eth_getBlockByNumber", [decimalBlockTag(finalizedSnapshot.number, "finalizedSnapshot.number"), false]),
    finalizedSnapshot,
    "finalizedSnapshot",
  );

  const currentLatest = record(await rpc.request("eth_getBlockByNumber", ["latest", false]), "currentLatest");
  const currentFinalized = record(
    await rpc.request("eth_getBlockByNumber", ["finalized", false]),
    "currentFinalized",
  );
  if (BigInt(stringField(currentLatest.number, "currentLatest.number")) < BigInt(stringField(latestSnapshot.number, "latestSnapshot.number"))) {
    throw new Error("V1 testnet latest head precedes the pinned snapshot");
  }
  if (
    BigInt(stringField(currentFinalized.number, "currentFinalized.number")) <
    BigInt(stringField(finalizedSnapshot.number, "finalizedSnapshot.number"))
  ) {
    throw new Error("V1 testnet finalized head precedes the pinned snapshot");
  }

  const stateReadTag = stringField(chain.dependencyStateReadTag, "chain.dependencyStateReadTag");
  if (stateReadTag !== "latest") throw new Error("V1 testnet dependency state tag must be latest");
  const dependencies = records(plan.externalDependencies, "externalDependencies");
  for (const dependency of dependencies) {
    if (
      stringField(dependency.observationBlockHash, "dependency.observationBlockHash").toLowerCase() !==
      stringField(latestSnapshot.hash, "latestSnapshot.hash").toLowerCase()
    ) {
      throw new Error(`V1 testnet dependency observation anchor drift: ${String(dependency.name)}`);
    }
    const runtime = await rpc.request("eth_getCode", [dependency.address, stateReadTag]);
    assertV1TestnetRuntimeObservation(dependency, runtime);
  }

  const byName = new Map(dependencies.map((dependency) => [String(dependency.name), dependency]));
  const positionManager = record(byName.get("POSITION_MANAGER"), "POSITION_MANAGER");
  const poolManager = record(byName.get("POOL_MANAGER"), "POOL_MANAGER");
  const permit2 = record(byName.get("PERMIT2"), "PERMIT2");
  for (const [signature, expected] of [
    ["poolManager()", poolManager.address],
    ["permit2()", permit2.address],
  ] as const) {
    const observed = await rpc.request("eth_call", [
      { to: positionManager.address, data: selector(signature) },
      stateReadTag,
    ]);
    if (addressResult(observed, `POSITION_MANAGER.${signature}`) !== String(expected).toLowerCase()) {
      throw new Error(`V1 testnet PositionManager binding drift: ${signature}`);
    }
  }

  return Object.freeze({
    chainId: expectedChainId,
    pinnedLatestBlock: stringField(latestSnapshot.number, "latestSnapshot.number"),
    pinnedFinalizedBlock: stringField(finalizedSnapshot.number, "finalizedSnapshot.number"),
    currentLatestBlock: BigInt(stringField(currentLatest.number, "currentLatest.number")).toString(10),
    currentFinalizedBlock: BigInt(stringField(currentFinalized.number, "currentFinalized.number")).toString(10),
    dependenciesChecked: dependencies.length,
    positionManagerBindingsChecked: 2,
    stateReadTag: "latest",
  });
}

export const v1TestnetDeploymentPlan = Object.freeze(
  JSON.parse(
    readFileSync(
      new URL("../../manifests/robinhood-testnet-46630.v1.plan.json", import.meta.url),
      "utf8",
    ),
  ) as JsonRecord,
);

// A saved plan is historical evidence. Validate on explicit load/use, never as a library import side effect.

export function loadV1TestnetDeploymentPlan(target = "robinhood-testnet") {
  const filename = target === "robinhood-testnet" ? "robinhood-testnet-46630.v1.plan.json"
    : target === "arbitrum-sepolia" ? "arbitrum-sepolia-421614.v1.plan.json" : undefined;
  if (!filename) throw new Error("Unsupported V1 testnet target");
  const plan = JSON.parse(readFileSync(new URL(`../../manifests/${filename}`, import.meta.url), "utf8")) as JsonRecord;
  assertV1TestnetDeploymentPlanConsistency(plan);
  return Object.freeze(plan);
}
