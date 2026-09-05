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
  assert.equal((plan.deploymentGateEvidence as JsonRecord[]).every((gate) => gate.status === "CLOSED"), true);
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


test("current gate evidence binds every current source file and passing validation log", () => {
  const current = JSON.parse(readFileSync(path.join(repositoryRoot, "deployments/evidence/v1-deployment-gates-current.json"), "utf8"));
  assert.deepEqual(validateV1DeploymentGateEvidenceSchema(current), { valid: true, errors: [] });
  assert.equal(current.applicability.status, "CURRENT");
  assert.equal(current.artifactEvidence.productArtifactManifestSha256, sha256(current.artifactEvidence.productArtifactManifest));
  const paths = new Set<string>();
  for (const file of current.artifactEvidence.files) {
    assert.equal(file.sha256, sha256(file.path), file.path);
    paths.add(file.path);
  }
  for (const required of ["contracts/script/v1/V1ReleaseGate.sol", "contracts/src/v1/modules/OfficialStockRegistryV1.sol", "contracts/test/v1/fork/V1ProductForkE2E.t.sol", "outputs/reviews/testnet-release-candidate/contracts.log", "outputs/reviews/testnet-release-candidate/fork.log"]) assert.ok(paths.has(required), required);
  assert.equal(current.forkEvidence.l2BlockNumber, (plan.forkEvidence as JsonRecord).blockNumber);
  assert.equal(current.forkEvidence.l2BlockHash, (plan.forkEvidence as JsonRecord).blockHash);
  assert.deepEqual(new Set(current.gates.map((gate: JsonRecord) => gate.gateId)), new Set(V1_DEPLOYMENT_GATE_IDS));
  assert.ok(current.gates.every((gate: JsonRecord) => gate.status === "CLOSED"));
});
