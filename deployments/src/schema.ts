import { readFileSync } from "node:fs";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

const schema = JSON.parse(
  readFileSync(new URL("../schemas/v2-deployment-manifest.schema.json", import.meta.url), "utf8"),
) as object;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema) as ValidateFunction<unknown>;

export type DeploymentSchemaResult = Readonly<{
  valid: boolean;
  errors: readonly ErrorObject[];
}>;

export function validateV2DeploymentManifestSchema(value: unknown): DeploymentSchemaResult {
  const valid = validate(value);
  return Object.freeze({ valid, errors: Object.freeze([...(validate.errors ?? [])]) });
}

export function assertV2DeploymentManifestSchema(value: unknown): void {
  const result = validateV2DeploymentManifestSchema(value);
  if (result.valid) return;
  const summary = result.errors
    .slice(0, 8)
    .map((error) => `${error.instancePath || "$"} ${error.message ?? error.keyword}`)
    .join("; ");
  throw new Error(`Invalid TickerGarden V2 deployment manifest: ${summary}`);
}
