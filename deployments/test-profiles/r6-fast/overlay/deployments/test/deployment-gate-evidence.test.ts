import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { validateV1DeploymentGateEvidenceSchema } from "../src/schema.ts";
import { V1_DEPLOYMENT_GATE_IDS } from "../src/v1/testnet-plan.ts";

type JsonRecord = Record<string, unknown>;

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidence = JSON.parse(
  readFileSync(path.join(repositoryRoot, "deployments/evidence/v1-deployment-gates.json"), "utf8"),
) as JsonRecord;
const plan = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "deployments/manifests/robinhood-testnet-46630.v1.plan.json"),
    "utf8",
  ),
) as JsonRecord;
const executionManifest = JSON.parse(
  readFileSync(path.join(repositoryRoot, "spec/v1_execution_manifest.json"), "utf8"),
) as JsonRecord;

function sha256(relativePath: string): string {
  const bytes = readFileSync(path.join(repositoryRoot, relativePath));
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

test("retains stale historical evidence separately from refreshed current gates", () => {
  assert.deepEqual(validateV1DeploymentGateEvidenceSchema(evidence), { valid: true, errors: [] });
  const gates = evidence.gates as JsonRecord[];
  assert.deepEqual(new Set(gates.map((gate) => gate.gateId)), new Set(V1_DEPLOYMENT_GATE_IDS));
  assert.equal(gates.every((gate) => gate.status === "CLOSED"), true);
  assert.equal((evidence.applicability as JsonRecord).status, "STALE");
  assert.equal((executionManifest.readiness as JsonRecord).state, "DEPLOYMENT_ELIGIBLE");
  assert.equal((executionManifest.readiness as JsonRecord).deploymentEligible, true);
  assert.deepEqual(
    (((executionManifest.readiness as JsonRecord).gateSets as JsonRecord).deployment as JsonRecord).open,
    [],
  );
});

test("stale evidence cannot attest to the current product artifact", () => {
  const artifacts = evidence.artifactEvidence as JsonRecord;
  assert.notEqual(sha256(String(artifacts.productArtifactManifest)), artifacts.productArtifactManifestSha256);
  assert.equal((evidence.applicability as JsonRecord).status, "STALE");
  assert.equal((executionManifest.readiness as JsonRecord).deploymentEligible, true);
  assert.deepEqual((plan.deploymentGateEvidence as JsonRecord[]).filter(gate => gate.status === "OPEN").map(gate => gate.gateId), []);
});

test("preserves historical dependencies and Fork pin while current rehearsal is refreshed", () => {
  const projectedDependencies = (plan.externalDependencies as JsonRecord[]).map(
    ({ name, address, runtimeCodeHash, runtimeCodeSize }) => ({
      name,
      address,
      runtimeCodeHash,
      runtimeCodeSize,
    }),
  );
  assert.deepEqual(evidence.externalDependencies, projectedDependencies);
  const fork = evidence.forkEvidence as JsonRecord;
  const planFork = plan.forkEvidence as JsonRecord;
  assert.equal(fork.l2BlockNumber, "54574453");
  assert.equal(fork.l2BlockHash, "0x890779a9495c5e825a5c19c70d0de3afd3e4076e7da74387346b30bc79460e22");
  assert.match(String(planFork.blockNumber), /^[1-9][0-9]*$/);
  assert.match(String(planFork.blockHash), /^0x[0-9a-f]{64}$/);
  assert.equal(planFork.status, "PASSED");
  assert.equal(fork.result, "PASSED"); // Historical snapshot, not current-revision evidence.
});


test("pre-brand evidence cannot certify renamed sources or reopen deployment", () => {
  const previous = JSON.parse(readFileSync(path.join(repositoryRoot, "deployments/evidence/v1-arbitrum-support-rh-regression.json"), "utf8"));
  assert.deepEqual(validateV1DeploymentGateEvidenceSchema(previous), { valid: true, errors: [] });
  assert.equal(previous.applicability.status, "STALE");
  assert.notEqual(previous.artifactEvidence.productArtifactManifestSha256, sha256(previous.artifactEvidence.productArtifactManifest));
  assert.equal((executionManifest.readiness as JsonRecord).deploymentEligible, true);
  assert.ok(previous.gates.every((gate: JsonRecord) => gate.status === "CLOSED")); // Historical results retained, not re-attested.
});

test("R3 evidence is historical after the no-staking fee fix", () => {
 const previous = JSON.parse(readFileSync(path.join(repositoryRoot, "deployments/evidence/v1-r3-test-validation.json"), "utf8"));
 const artifact = previous.files.find((file: {path: string}) => file.path === "spec/v1_product_artifact_manifest.json");
 assert.notEqual(sha256(artifact.path), artifact.sha256);
});

test("R5 historical evidence remains bound to the untouched parent checkout", () => {
 const current = JSON.parse(readFileSync(path.join(repositoryRoot, "deployments/evidence/v1-r5-test-validation.json"), "utf8"));
 assert.equal(current.status, "VERIFIED_TEST_ONLY_CANDIDATE");
 assert.equal(current.productionReady, false);
 assert.equal(current.chainId, 421614);
 assert.equal(current.productionTargetChainId, 4663);
 for (const required of [
   "contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol",
   "contracts/test/v1/shared/ProtocolFeeVaultLiabilities.t.sol",
   "contracts/test/v1/shared/RewardSettlement.t.sol",
   "contracts/test/v1/fork/V1ProductForkE2E.t.sol",
   "contracts/test/v1/fork/V1ArbitrumSepoliaForkE2E.t.sol",
   "outputs/reviews/arbitrum-r4-fix/contracts-clean-strict.log",
   "outputs/reviews/arbitrum-r4-fix/arbitrum-clean-fork.log",
   "outputs/reviews/arbitrum-r4-fix/rh-clean-fork.log",
 ]) assert.ok(current.files.some((file: {path: string}) => file.path === required), required);
 for (const file of current.files) assert.equal(sha256(path.join("../..", file.path)), file.sha256, file.path);
});
