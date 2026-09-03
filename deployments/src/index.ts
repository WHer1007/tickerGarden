/** Fail-closed deployment boundary. It reads the canonical spec manifest and never
 * submits transactions or treats a scaffold/artifact as deployment evidence. */
import { readFileSync } from "node:fs";

import {
  V2_READINESS_STATES,
  assertNoProductionPlaceholders,
  deriveV2ReadinessState,
  readinessFlags,
  type ProductionPlaceholderPolicy,
  type V2GateSets,
  type V2ReadinessState,
  type ZeroRule,
} from "./readiness.ts";
import { assertV2DeploymentManifestSchema } from "./schema.ts";

export * from "./readiness.ts";
export * from "./schema.ts";
export * from "./v2/preflight.ts";
export * from "./v2/access-manager-plan.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid V2 execution manifest object: ${label}`);
  }
  return value as JsonRecord;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid V2 execution manifest string: ${label}`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid V2 execution manifest boolean: ${label}`);
  }
  return value;
}

function strings(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(`Invalid V2 execution manifest string array: ${label}`);
  }
  return Object.freeze([...value] as string[]);
}

function readinessState(value: unknown, label: string): V2ReadinessState {
  const candidate = stringValue(value, label);
  if (!V2_READINESS_STATES.includes(candidate as V2ReadinessState)) {
    throw new Error(`Invalid V2 readiness state: ${label}=${candidate}`);
  }
  return candidate as V2ReadinessState;
}

function zeroRules(value: unknown): readonly ZeroRule[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid V2 execution manifest array: placeholderPolicy.allowedZeroRules");
  }
  return Object.freeze(
    value.map((untypedRule, index) => {
      const rule = record(untypedRule, `placeholderPolicy.allowedZeroRules.${index}`);
      const pathPattern = stringValue(
        rule.pathPattern,
        `placeholderPolicy.allowedZeroRules.${index}.pathPattern`,
      );
      if (!("requiresSibling" in rule)) return Object.freeze({ pathPattern });
      const sibling = record(
        rule.requiresSibling,
        `placeholderPolicy.allowedZeroRules.${index}.requiresSibling`,
      );
      return Object.freeze({
        pathPattern,
        requiresSibling: Object.freeze({
          field: stringValue(
            sibling.field,
            `placeholderPolicy.allowedZeroRules.${index}.requiresSibling.field`,
          ),
          equals: stringValue(
            sibling.equals,
            `placeholderPolicy.allowedZeroRules.${index}.requiresSibling.equals`,
          ),
        }),
      });
    }),
  );
}

function loadJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}

const manifest = record(loadJson("../../spec/v2_execution_manifest.json"), "root");
const machineReadiness = record(manifest.readiness, "readiness");
const machineGateSets = record(machineReadiness.gateSets, "readiness.gateSets");

function gate(name: "implementation" | "deployment" | "production"): readonly string[] {
  return strings(record(machineGateSets[name], `readiness.gateSets.${name}`).open, `${name}.open`);
}

export const V2_EXECUTION_SPEC_ID = stringValue(manifest.executionSpecId, "executionSpecId");
export const v2GateSets: V2GateSets = Object.freeze({
  implementation: gate("implementation"),
  deployment: gate("deployment"),
  production: gate("production"),
});

const derivedState = deriveV2ReadinessState(v2GateSets);
const declaredState = readinessState(machineReadiness.state, "readiness.state");
const manifestStatus = readinessState(manifest.status, "status");
if (derivedState !== declaredState || manifestStatus !== declaredState) {
  throw new Error(
    `TickerGarden V2 readiness drift: declared=${declaredState} derived=${derivedState} status=${manifestStatus}`,
  );
}

const flags = readinessFlags(derivedState);
for (const key of ["implementationAllowed", "deploymentEligible", "productionReady"] as const) {
  if (booleanValue(machineReadiness[key], `readiness.${key}`) !== flags[key]) {
    throw new Error(`TickerGarden V2 readiness flag drift: ${key}`);
  }
}

export type V2ReadinessDescriptor = Readonly<{
  executionSpecId: string;
  state: V2ReadinessState;
  implementationAllowed: boolean;
  deploymentEligible: boolean;
  productionReady: boolean;
  openGates: V2GateSets;
}>;

export const v2Readiness: V2ReadinessDescriptor = Object.freeze({
  executionSpecId: V2_EXECUTION_SPEC_ID,
  state: derivedState,
  ...flags,
  openGates: v2GateSets,
});

const machinePlaceholderPolicy = record(
  machineReadiness.placeholderPolicy,
  "readiness.placeholderPolicy",
);
export const productionPlaceholderPolicy: ProductionPlaceholderPolicy = Object.freeze({
  scopeGlob: stringValue(machinePlaceholderPolicy.scopeGlob, "placeholderPolicy.scopeGlob"),
  failClosed: booleanValue(machinePlaceholderPolicy.failClosed, "placeholderPolicy.failClosed"),
  reject: strings(machinePlaceholderPolicy.reject, "placeholderPolicy.reject"),
  allowedZeroRules: zeroRules(machinePlaceholderPolicy.allowedZeroRules),
});

function collectHexIdentifiers(value: unknown, output: Set<string>): void {
  if (typeof value === "string" && /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value)) {
    output.add(value.toLowerCase());
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectHexIdentifiers(item, output));
  } else if (value !== null && typeof value === "object") {
    Object.values(value as JsonRecord).forEach((item) => collectHexIdentifiers(item, output));
  }
}

function jsonPointer(root: unknown, pointer: string): unknown {
  return pointer
    .split("/")
    .slice(1)
    .reduce<unknown>((current, segment) => record(current, pointer)[segment], root);
}

const fixtureValues = new Set<string>();
const fixtureScopes = machinePlaceholderPolicy.referenceFixtureScopes;
if (!Array.isArray(fixtureScopes)) throw new Error("Invalid referenceFixtureScopes");
for (const untypedScope of fixtureScopes) {
  const scope = record(untypedScope, "referenceFixtureScope");
  const file = stringValue(scope.file, "referenceFixtureScope.file");
  const pointer = stringValue(scope.jsonPointer, "referenceFixtureScope.jsonPointer");
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid JSON pointer in referenceFixtureScope: ${pointer}`);
  }
  const source = loadJson(`../../${file}`);
  collectHexIdentifiers(jsonPointer(source, pointer), fixtureValues);
}
export const referenceFixtureValues: ReadonlySet<string> = fixtureValues;

export function assertV2DeploymentManifest(value: unknown): void {
  assertV2DeploymentManifestSchema(value);
  assertNoProductionPlaceholders(
    value,
    productionPlaceholderPolicy,
    referenceFixtureValues,
  );
}

function firstBlockingGateSet(
  descriptor: V2ReadinessDescriptor,
  includeProduction: boolean,
): Readonly<{ stage: string; gates: readonly string[] }> {
  const stages = includeProduction
    ? (["implementation", "deployment", "production"] as const)
    : (["implementation", "deployment"] as const);
  for (const stage of stages) {
    const gates = descriptor.openGates[stage];
    if (gates.length > 0) return { stage, gates };
  }
  return { stage: "readiness-consistency", gates: ["STATE_OR_FLAG_DRIFT"] };
}

export function isV2Deployable(descriptor: V2ReadinessDescriptor = v2Readiness): boolean {
  return descriptor.deploymentEligible;
}

export function assertV2Deployable(descriptor: V2ReadinessDescriptor = v2Readiness): void {
  if (isV2Deployable(descriptor)) return;
  const blocking = firstBlockingGateSet(descriptor, false);
  throw new Error(
    `TickerGarden V2 deployment is blocked at ${descriptor.state} by ${blocking.stage} gates: ${blocking.gates.join(", ")}`,
  );
}

export function assertV2ProductionReady(
  descriptor: V2ReadinessDescriptor = v2Readiness,
): void {
  if (descriptor.productionReady) return;
  const blocking = firstBlockingGateSet(descriptor, true);
  throw new Error(
    `TickerGarden V2 production is blocked at ${descriptor.state} by ${blocking.stage} gates: ${blocking.gates.join(", ")}`,
  );
}
