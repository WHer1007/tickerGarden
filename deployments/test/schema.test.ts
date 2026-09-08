import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { assertV1DeploymentManifest, validateV1DeploymentManifestSchema } from "../src/index.ts";
import { V1_DEPLOYMENT_GATE_IDS } from "../src/v1/testnet-plan.ts";
import { address, clone, compiled, hash, permissions, validManifest, type JsonRecord } from "./manifest-fixture.ts";

const deploymentSchema = JSON.parse(readFileSync(new URL("../schemas/v1-deployment-manifest.schema.json", import.meta.url), "utf8")) as JsonRecord;
const executionManifest = JSON.parse(readFileSync(new URL("../../spec/v1_execution_manifest.json", import.meta.url), "utf8")) as { readiness: { gateSets: { deployment: { open: string[] } } } };

test("accepts a complete V1-EXEC-11 deployment candidate and native zero sentinel", () => {
  const candidate = validManifest();
  assert.deepEqual(validateV1DeploymentManifestSchema(candidate), { valid: true, errors: [] });
  assert.doesNotThrow(() => assertV1DeploymentManifest(candidate));
});

test("accepts chain 46630 only as a non-production deployment candidate", () => {
  const testnet = clone(validManifest());
  (testnet.chain as JsonRecord).chainId = 46630;
  (testnet.chain as JsonRecord).network = "Robinhood Chain Testnet";
  assert.deepEqual(validateV1DeploymentManifestSchema(testnet), { valid: true, errors: [] });
  assert.doesNotThrow(() => assertV1DeploymentManifest(testnet));

  testnet.releaseStatus = "PRODUCTION_CANDIDATE";
  assert.equal(validateV1DeploymentManifestSchema(testnet).valid, false);
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
  assert.deepEqual(gateIds, [...V1_DEPLOYMENT_GATE_IDS].sort());
  assert.ok(executionManifest.readiness.gateSets.deployment.open.every(id => gateIds.includes(id)));
});

test("rejects missing chain evidence and missing canonical modules", () => {
  const missingBlock = clone(validManifest());
  delete (missingBlock.chain as JsonRecord).finalizedBlockHash;
  assert.equal(validateV1DeploymentManifestSchema(missingBlock).valid, false);
  const missingModule = clone(validManifest());
  delete (missingModule.protocolModules as JsonRecord).MarketRegistryV1;
  assert.equal(validateV1DeploymentManifestSchema(missingModule).valid, false);
});

test("rejects ERC20 zero addresses, invalid Hook permissions, and incomplete CREATE2", () => {
  const erc20Zero = clone(validManifest());
  erc20Zero.quoteAssets = [{ ...(erc20Zero.quoteAssets as JsonRecord[])[0], assetKind: "ERC20" }];
  assert.equal(validateV1DeploymentManifestSchema(erc20Zero).valid, false);
  const wrongHook = clone(validManifest());
  (wrongHook.hook as JsonRecord).permissionMaskHex = "0x0000";
  assert.equal(validateV1DeploymentManifestSchema(wrongHook).valid, false);
  const missingLocker = clone(validManifest());
  delete ((missingLocker.create2 as JsonRecord).components as JsonRecord).LOCKER;
  assert.equal(validateV1DeploymentManifestSchema(missingLocker).valid, false);

  const missingGaugeImplementation = clone(validManifest());
  delete ((((missingGaugeImplementation.create2 as JsonRecord).components as JsonRecord).GAUGE as JsonRecord).implementationAddress);
  assert.equal(validateV1DeploymentManifestSchema(missingGaugeImplementation).valid, false);

  const fullGauge = clone(validManifest());
  ((((fullGauge.create2 as JsonRecord).components as JsonRecord).GAUGE as JsonRecord).deploymentKind) = "FULL_CREATE2";
  assert.equal(validateV1DeploymentManifestSchema(fullGauge).valid, false);
});

test("release schema accepts administrator-reviewed ERC20 proxy kinds", () => {
  for (const proxyKind of ["ERC1967", "BEACON", "OTHER_VERIFIED"]) {
    const candidate = clone(validManifest());
    candidate.quoteAssets = [{
      configId: hash("erc20-quote"),
      tickerGardenBaselineId: hash("baseline"),
      economicsHash: hash("erc20-economics"),
      assetKind: "ERC20",
      tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
      decimals: 6,
      phantomQuote: "1000000",
      graduationThreshold: "2000000",
      runtimeCodeHash: hash("erc20-runtime"),
      proxyKind,
      implementationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      implementationCodeHash: hash("erc20-runtime"),
      observationBlockHash: hash("erc20-observation"),
      exactBalanceDeltaEvidenceHash: hash("erc20-balance-delta"),
    }];
    assert.equal(validateV1DeploymentManifestSchema(candidate).valid, true, proxyKind);
  }
});

test("accepts DIRECT Official Stock shape and rejects beacon leakage or missing discriminator", () => {
  const direct = clone(validManifest());
  const stock = (direct.officialStocks as JsonRecord[])[0]!;
  stock.proxyKind = "DIRECT";
  stock.implementationAddress = stock.tokenAddress;
  stock.implementationCodeHash = stock.runtimeCodeHash;
  delete stock.beaconAddress;
  delete stock.beaconCodeHash;
  assert.equal(validateV1DeploymentManifestSchema(direct).valid, true);

  const beaconLeak = clone(direct);
  (beaconLeak.officialStocks as JsonRecord[])[0]!.beaconAddress = address("unexpected-beacon");
  assert.equal(validateV1DeploymentManifestSchema(beaconLeak).valid, false);

  const missingKind = clone(direct);
  delete (missingKind.officialStocks as JsonRecord[])[0]!.proxyKind;
  assert.equal(validateV1DeploymentManifestSchema(missingKind).valid, false);
});

test("accepts a complete OFFICIAL_STOCK Quote and rejects incomplete or non-Beacon shapes", () => {
  const candidate = clone(validManifest());
  const stock = (candidate.officialStocks as JsonRecord[])[0]!;
  candidate.quoteAssets = [{
    configId: hash("stock-quote"), tickerGardenBaselineId: hash("baseline"), economicsHash: hash("stock-economics"),
    assetKind: "OFFICIAL_STOCK", assetUid: stock.assetUid, tokenAddress: stock.tokenAddress, decimals: stock.decimals,
    phantomQuote: "1000000", graduationThreshold: "2000000", stockTokenFingerprintHash: hash("fingerprint"),
    referenceEvidenceHash: hash("reference"), generatorPolicyId: hash("generator"), runtimeCodeHash: stock.runtimeCodeHash,
    proxyKind: "IMMUTABLE_BEACON", beaconAddress: stock.beaconAddress, beaconCodeHash: stock.beaconCodeHash,
    implementationAddress: stock.implementationAddress, implementationCodeHash: stock.implementationCodeHash,
    observationBlockHash: hash("observation"), exactBalanceDeltaEvidenceHash: hash("balance-delta"),
  }];
  assert.equal(validateV1DeploymentManifestSchema(candidate).valid, true);

  const missingFingerprint = clone(candidate);
  delete (missingFingerprint.quoteAssets as JsonRecord[])[0]!.stockTokenFingerprintHash;
  assert.equal(validateV1DeploymentManifestSchema(missingFingerprint).valid, false);
  const wrongProxy = clone(candidate);
  (wrongProxy.quoteAssets as JsonRecord[])[0]!.proxyKind = "NONE";
  assert.equal(validateV1DeploymentManifestSchema(wrongProxy).valid, false);
});

test("requires exactly 87 protocol and 6 AccessManager permissions", () => {
  const candidate = clone(validManifest());
  const manager = candidate.accessManager as JsonRecord;
  manager.protocolPermissions = (manager.protocolPermissions as unknown[]).slice(1);
  assert.equal(validateV1DeploymentManifestSchema(candidate).valid, false);
});

test("requires one evidence record for every deployment gate", () => {
  const candidate = clone(validManifest());
  const evidence = (candidate.evidence as JsonRecord[]).slice();
  evidence[0] = { ...evidence[1], contentHash: hash("duplicate-gate-different-record") };
  candidate.evidence = evidence;
  assert.equal(validateV1DeploymentManifestSchema(candidate).valid, false);
  const inventedClosure = clone(validManifest());
  const certificate = inventedClosure.readinessCertificate as JsonRecord;
  const closed = [...(certificate.closedDeploymentGateEvidence as string[])];
  closed[0] = "V1-DEPLOY-INVENTED-EVIDENCE-01";
  certificate.closedDeploymentGateEvidence = closed;
  assert.equal(validateV1DeploymentManifestSchema(inventedClosure).valid, false);
});

test("rejects unknown fields, placeholders, low-entropy identifiers, and incomplete live probes", () => {
  const extra = clone(validManifest());
  extra.manualReadinessOverride = true;
  assert.equal(validateV1DeploymentManifestSchema(extra).valid, false);
  const missingProbe = clone(validManifest());
  delete (missingProbe.livePreflight as JsonRecord).marketProbe;
  assert.equal(validateV1DeploymentManifestSchema(missingProbe).valid, false);
  const placeholder = clone(validManifest());
  (placeholder.chain as JsonRecord).network = "placeholder network";
  assert.throws(() => assertV1DeploymentManifest(placeholder), /contains placeholders/);
  const lowEntropy = clone(validManifest());
  (lowEntropy.chain as JsonRecord).finalizedBlockHash = `0x${"11".repeat(32)}`;
  assert.throws(() => assertV1DeploymentManifest(lowEntropy), /contains placeholders/);
});

test("Arbitrum Sepolia can only be a test deployment candidate, never the production target", () => {
  const candidate = clone(validManifest());
  (candidate.chain as JsonRecord).chainId = 421614;
  (candidate.chain as JsonRecord).network = "Arbitrum Sepolia";
  assert.deepEqual(validateV1DeploymentManifestSchema(candidate), { valid: true, errors: [] });
  assert.doesNotThrow(() => assertV1DeploymentManifest(candidate));
  candidate.releaseStatus = "PRODUCTION_CANDIDATE";
  assert.equal(validateV1DeploymentManifestSchema(candidate).valid, false);
});
