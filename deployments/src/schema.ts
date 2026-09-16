import { readFileSync } from "node:fs";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

const schema = JSON.parse(
  readFileSync(new URL("../schemas/v1-deployment-manifest.schema.json", import.meta.url), "utf8"),
) as object;
const testnetPlanSchema = JSON.parse(
  readFileSync(new URL("../schemas/v1-testnet-deployment-plan.schema.json", import.meta.url), "utf8"),
) as object;
const deploymentGateEvidenceSchema = JSON.parse(
  readFileSync(new URL("../schemas/v1-deployment-gate-evidence.schema.json", import.meta.url), "utf8"),
) as object;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema) as ValidateFunction<unknown>;
const validateTestnetPlan = ajv.compile(testnetPlanSchema) as ValidateFunction<unknown>;
const validateDeploymentGateEvidence = ajv.compile(deploymentGateEvidenceSchema) as ValidateFunction<unknown>;

export type DeploymentSchemaResult = Readonly<{
  valid: boolean;
  errors: readonly ErrorObject[];
}>;

export function validateV1DeploymentManifestSchema(value: unknown): DeploymentSchemaResult {
  const valid = validate(value);
  return Object.freeze({ valid, errors: Object.freeze([...(validate.errors ?? [])]) });
}

export function assertV1DeploymentManifestSchema(value: unknown): void {
  const result = validateV1DeploymentManifestSchema(value);
  if (result.valid) return;
  const summary = result.errors
    .slice(0, 8)
    .map((error) => `${error.instancePath || "$"} ${error.message ?? error.keyword}`)
    .join("; ");
  throw new Error(`Invalid TickerGarden V1 deployment manifest: ${summary}`);
}

export function validateV1TestnetDeploymentPlanSchema(value: unknown): DeploymentSchemaResult {
  const valid = validateTestnetPlan(value);
  return Object.freeze({
    valid,
    errors: Object.freeze([...(validateTestnetPlan.errors ?? [])]),
  });
}

export function assertV1TestnetDeploymentPlanSchema(value: unknown): void {
  const result = validateV1TestnetDeploymentPlanSchema(value);
  if (result.valid) return;
  const summary = result.errors
    .slice(0, 8)
    .map((error) => `${error.instancePath || "$"} ${error.message ?? error.keyword}`)
    .join("; ");
  throw new Error(`Invalid TickerGarden V1 testnet deployment plan: ${summary}`);
}

export function validateV1DeploymentGateEvidenceSchema(value: unknown): DeploymentSchemaResult {
  const valid = validateDeploymentGateEvidence(value);
  return Object.freeze({
    valid,
    errors: Object.freeze([...(validateDeploymentGateEvidence.errors ?? [])]),
  });
}

export function assertV1DeploymentGateEvidenceSchema(value: unknown): void {
  const result = validateV1DeploymentGateEvidenceSchema(value);
  if (result.valid) return;
  const summary = result.errors
    .slice(0, 8)
    .map((error) => `${error.instancePath || "$"} ${error.message ?? error.keyword}`)
    .join("; ");
  throw new Error(`Invalid TickerGarden V1 deployment gate evidence: ${summary}`);
}
