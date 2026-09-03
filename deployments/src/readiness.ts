export const V1_READINESS_STATES = [
  "SPEC_FROZEN_NOT_DEPLOYABLE",
  "IMPLEMENTATION_ALLOWED",
  "DEPLOYMENT_ELIGIBLE",
  "PRODUCTION_READY",
] as const;

export type V1ReadinessState = (typeof V1_READINESS_STATES)[number];
export type ReadinessGateName = "implementation" | "deployment" | "production";

export type V1GateSets = Readonly<Record<ReadinessGateName, readonly string[]>>;

export type ZeroRule = Readonly<{
  pathPattern: string;
  requiresSibling?: Readonly<{ field: string; equals: string }>;
}>;

export type ProductionPlaceholderPolicy = Readonly<{
  scopeGlob: string;
  failClosed: boolean;
  reject: readonly string[];
  allowedZeroRules: readonly ZeroRule[];
}>;

export type PlaceholderViolationCode =
  | "NULL"
  | "EMPTY_STRING"
  | "EMPTY_ARRAY"
  | "EMPTY_OBJECT"
  | "ZERO_ADDRESS_OR_HASH"
  | "LOW_ENTROPY_ADDRESS_OR_HASH"
  | "PLACEHOLDER_TAG"
  | "REFERENCE_FIXTURE_VALUE";

export type PlaceholderViolation = Readonly<{
  path: string;
  code: PlaceholderViolationCode;
  value?: string;
}>;

export function deriveV1ReadinessState(gates: V1GateSets): V1ReadinessState {
  if (gates.implementation.length > 0) return "SPEC_FROZEN_NOT_DEPLOYABLE";
  if (gates.deployment.length > 0) return "IMPLEMENTATION_ALLOWED";
  if (gates.production.length > 0) return "DEPLOYMENT_ELIGIBLE";
  return "PRODUCTION_READY";
}

export function readinessFlags(state: V1ReadinessState): Readonly<{
  implementationAllowed: boolean;
  deploymentEligible: boolean;
  productionReady: boolean;
}> {
  const index = V1_READINESS_STATES.indexOf(state);
  return Object.freeze({
    implementationAllowed: index >= V1_READINESS_STATES.indexOf("IMPLEMENTATION_ALLOWED"),
    deploymentEligible: index >= V1_READINESS_STATES.indexOf("DEPLOYMENT_ELIGIBLE"),
    productionReady: state === "PRODUCTION_READY",
  });
}

function pathMatches(pattern: string, actual: string): boolean {
  const expectedParts = pattern.split(".");
  const actualParts = actual.split(".");
  return (
    expectedParts.length === actualParts.length &&
    expectedParts.every((part, index) => part === "*" || part === actualParts[index])
  );
}

function zeroAllowed(
  path: string,
  parent: Readonly<Record<string, unknown>> | undefined,
  rules: readonly ZeroRule[],
): boolean {
  return rules.some((rule) => {
    if (!pathMatches(rule.pathPattern, path)) return false;
    if (rule.requiresSibling === undefined) return true;
    return parent?.[rule.requiresSibling.field] === rule.requiresSibling.equals;
  });
}

function isHexIdentifier(value: string): boolean {
  return /^(?:0x)(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value);
}

function isZeroHex(value: string): boolean {
  return /^0x0+$/.test(value.toLowerCase());
}

function isLowEntropyHex(value: string): boolean {
  const bytes = value.slice(2).toLowerCase().match(/../g) ?? [];
  return new Set(bytes).size <= 2;
}

const PLACEHOLDER_TAG = /(?:^|[^a-z])(draft|example|placeholder|tbd|todo|changeme|sample)(?:$|[^a-z])/i;

export function findProductionPlaceholderViolations(
  value: unknown,
  policy: ProductionPlaceholderPolicy,
  referenceFixtureValues: ReadonlySet<string> = new Set<string>(),
): readonly PlaceholderViolation[] {
  const violations: PlaceholderViolation[] = [];
  const fixtureValues = new Set([...referenceFixtureValues].map((item) => item.toLowerCase()));

  function visit(
    current: unknown,
    path: string,
    parent: Readonly<Record<string, unknown>> | undefined,
  ): void {
    if (current === null) {
      violations.push({ path, code: "NULL" });
      return;
    }

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (trimmed.length === 0) {
        violations.push({ path, code: "EMPTY_STRING" });
        return;
      }
      if (PLACEHOLDER_TAG.test(trimmed)) {
        violations.push({ path, code: "PLACEHOLDER_TAG", value: current });
      }
      if (isHexIdentifier(trimmed)) {
        const normalized = trimmed.toLowerCase();
        if (isZeroHex(normalized)) {
          if (!zeroAllowed(path, parent, policy.allowedZeroRules)) {
            violations.push({ path, code: "ZERO_ADDRESS_OR_HASH", value: current });
          }
          return;
        }
        if (isLowEntropyHex(normalized)) {
          violations.push({ path, code: "LOW_ENTROPY_ADDRESS_OR_HASH", value: current });
        }
        if (fixtureValues.has(normalized)) {
          violations.push({ path, code: "REFERENCE_FIXTURE_VALUE", value: current });
        }
      }
      return;
    }

    if (Array.isArray(current)) {
      if (current.length === 0) {
        violations.push({ path, code: "EMPTY_ARRAY" });
        return;
      }
      current.forEach((item, index) => visit(item, `${path}.${index}`, undefined));
      return;
    }

    if (typeof current === "object") {
      const record = current as Readonly<Record<string, unknown>>;
      const entries = Object.entries(record);
      if (entries.length === 0) {
        violations.push({ path, code: "EMPTY_OBJECT" });
        return;
      }
      for (const [key, item] of entries) visit(item, `${path}.${key}`, record);
    }
  }

  visit(value, "$", undefined);
  return Object.freeze(violations);
}

export function assertNoProductionPlaceholders(
  value: unknown,
  policy: ProductionPlaceholderPolicy,
  referenceFixtureValues: ReadonlySet<string> = new Set<string>(),
): void {
  const violations = findProductionPlaceholderViolations(
    value,
    policy,
    referenceFixtureValues,
  );
  if (violations.length === 0) return;
  const summary = violations
    .slice(0, 8)
    .map((entry) => `${entry.code}@${entry.path}`)
    .join(", ");
  throw new Error(`TickerGarden V1 production manifest contains placeholders: ${summary}`);
}
