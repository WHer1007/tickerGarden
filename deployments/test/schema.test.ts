import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { assertV2DeploymentManifest, validateV2DeploymentManifestSchema } from "../src/index.ts";
import { clone, compiled, hash, permissions, validManifest, type JsonRecord } from "./manifest-fixture.ts";

const deploymentSchema = JSON.parse(readFileSync(new URL("../schemas/v2-deployment-manifest.schema.json", import.meta.url), "utf8")) as JsonRecord;
const executionManifest = JSON.parse(readFileSync(new URL("../../spec/v2_execution_manifest.json", import.meta.url), "utf8")) as { readiness: { gateSets: { deployment: { open: string[] } } } };

test("accepts a complete V2-EXEC-4 deployment candidate and native zero sentinel", () => {
  const candidate = validManifest();
  assert.deepEqual(validateV2DeploymentManifestSchema(candidate), { valid: true, errors: [] });
  assert.doesNotThrow(() => assertV2DeploymentManifest(candidate));
});

test("schema cardinalities and identities remain aligned with canonical machine manifests", () => {
  const rootProperties = deploymentSchema.properties as JsonRecord;
  const protocolModules = rootProperties.protocolModules as JsonRecord;
  assert.deepEqual([...(protocolModules.required as string[])].sort(), compiled.modules.map(({ target }) => target).sort());
  const definitions = deploymentSchema.$defs as JsonRecord;
  const accessProperties = (definitions.accessManagerEvidence as JsonRecord).properties as JsonRecord;
  const protocolPermissions = accessProperties.protocolPermissions as JsonRecord;
  const administrativePermissions = accessProperties.administrativePermissions as JsonRecord;
  assert.equal(protocolPermissions.minItems, compiled.mutations.length);
  assert.equal(protocolPermissions.maxItems, compiled.mutations.length);
  const adminCount = permissions.functions.filter((row) => row.module === "AccessManager").length;
  assert.equal(administrativePermissions.minItems, adminCount);
  assert.equal(administrativePermissions.maxItems, adminCount);
  const gateIds = [...((definitions.deploymentGateId as JsonRecord).enum as string[])].sort();
  assert.deepEqual(gateIds, [...executionManifest.readiness.gateSets.deployment.open].sort());
});

test("rejects missing chain evidence and missing canonical modules", () => {
  const missingBlock = clone(validManifest());
  delete (missingBlock.chain as JsonRecord).finalizedBlockHash;
  assert.equal(validateV2DeploymentManifestSchema(missingBlock).valid, false);
  const missingModule = clone(validManifest());
  delete (missingModule.protocolModules as JsonRecord).MarketRegistryV2;
  assert.equal(validateV2DeploymentManifestSchema(missingModule).valid, false);
});

test("rejects ERC20 zero addresses, invalid Hook permissions, and incomplete CREATE2", () => {
  const erc20Zero = clone(validManifest());
  erc20Zero.quoteAssets = [{ ...(erc20Zero.quoteAssets as JsonRecord[])[0], assetKind: "ERC20" }];
  assert.equal(validateV2DeploymentManifestSchema(erc20Zero).valid, false);
  const wrongHook = clone(validManifest());
  (wrongHook.hook as JsonRecord).permissionMaskHex = "0x0000";
  assert.equal(validateV2DeploymentManifestSchema(wrongHook).valid, false);
  const missingLocker = clone(validManifest());
  delete ((missingLocker.create2 as JsonRecord).components as JsonRecord).LOCKER;
  assert.equal(validateV2DeploymentManifestSchema(missingLocker).valid, false);

  const missingGaugeImplementation = clone(validManifest());
  delete ((((missingGaugeImplementation.create2 as JsonRecord).components as JsonRecord).GAUGE as JsonRecord).implementationAddress);
  assert.equal(validateV2DeploymentManifestSchema(missingGaugeImplementation).valid, false);

  const fullGauge = clone(validManifest());
  ((((fullGauge.create2 as JsonRecord).components as JsonRecord).GAUGE as JsonRecord).deploymentKind) = "FULL_CREATE2";
  assert.equal(validateV2DeploymentManifestSchema(fullGauge).valid, false);
});

test("requires exactly 85 protocol and 6 AccessManager permissions", () => {
  const candidate = clone(validManifest());
  const manager = candidate.accessManager as JsonRecord;
  manager.protocolPermissions = (manager.protocolPermissions as unknown[]).slice(1);
  assert.equal(validateV2DeploymentManifestSchema(candidate).valid, false);
});

test("requires one evidence record for every deployment gate", () => {
  const candidate = clone(validManifest());
  const evidence = (candidate.evidence as JsonRecord[]).slice();
  evidence[0] = { ...evidence[1], contentHash: hash("duplicate-gate-different-record") };
  candidate.evidence = evidence;
  assert.equal(validateV2DeploymentManifestSchema(candidate).valid, false);
  const inventedClosure = clone(validManifest());
  const certificate = inventedClosure.readinessCertificate as JsonRecord;
  const closed = [...(certificate.closedDeploymentGateEvidence as string[])];
  closed[0] = "V2-DEPLOY-INVENTED-EVIDENCE-01";
  certificate.closedDeploymentGateEvidence = closed;
  assert.equal(validateV2DeploymentManifestSchema(inventedClosure).valid, false);
});

test("rejects unknown fields, placeholders, low-entropy identifiers, and incomplete live probes", () => {
  const extra = clone(validManifest());
  extra.manualReadinessOverride = true;
  assert.equal(validateV2DeploymentManifestSchema(extra).valid, false);
  const missingProbe = clone(validManifest());
  delete (missingProbe.livePreflight as JsonRecord).marketProbe;
  assert.equal(validateV2DeploymentManifestSchema(missingProbe).valid, false);
  const placeholder = clone(validManifest());
  (placeholder.chain as JsonRecord).network = "placeholder network";
  assert.throws(() => assertV2DeploymentManifest(placeholder), /contains placeholders/);
  const lowEntropy = clone(validManifest());
  (lowEntropy.chain as JsonRecord).finalizedBlockHash = `0x${"11".repeat(32)}`;
  assert.throws(() => assertV2DeploymentManifest(lowEntropy), /contains placeholders/);
});
