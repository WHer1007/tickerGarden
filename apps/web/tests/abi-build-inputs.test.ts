import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, type TestContext } from "node:test";

const run = promisify(execFile);
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");

async function fixture(context: TestContext) {
  const root = await mkdtemp(resolve(tmpdir(), "tickergarden-abi-check-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve(repoRoot, "spec/v1_product_artifact_manifest.json"), resolve(root, "spec/v1_product_artifact_manifest.json"), { recursive: true });
  await cp(resolve(repoRoot, "contracts/src/v1/interfaces/IV1Protocol.sol"), resolve(root, "contracts/src/v1/interfaces/IV1Protocol.sol"), { recursive: true });
  await cp(resolve(webRoot, "scripts/generate-v1-abis.mjs"), resolve(root, "apps/web/scripts/generate-v1-abis.mjs"), { recursive: true });
  await cp(resolve(webRoot, "build-inputs/v1-abis.json"), resolve(root, "apps/web/build-inputs/v1-abis.json"), { recursive: true });
  await cp(resolve(webRoot, "src/v1/generated/abis.ts"), resolve(root, "apps/web/src/v1/generated/abis.ts"), { recursive: true });
  return root;
}

async function generate(root: string, ...args: string[]) {
  return run(process.execPath, ["apps/web/scripts/generate-v1-abis.mjs", ...args], { cwd: root });
}

test("source-only verification works without compiled contract artifacts", async (context) => {
  const root = await fixture(context);
  await assert.doesNotReject(generate(root, "--check", "--source-only"));
});

test("source-only verification rejects a corrupted ABI snapshot", async (context) => {
  const root = await fixture(context);
  const path = resolve(root, "apps/web/build-inputs/v1-abis.json");
  const inputs = JSON.parse(await readFile(path, "utf8"));
  inputs.modules[0].abi = [];
  await writeFile(path, JSON.stringify(inputs));
  await assert.rejects(generate(root, "--check", "--source-only"), /ABI build inputs differ from compiled artifacts|generated V1 ABI bridge is stale/);
});

test("source-only verification rejects stale interface or manifest sources", async (context) => {
  const sourceRoot = await fixture(context);
  await writeFile(resolve(sourceRoot, "contracts/src/v1/interfaces/IV1Protocol.sol"), "// changed\n");
  await assert.rejects(generate(sourceRoot, "--check", "--source-only"), /source identity is stale/);

  const manifestRoot = await fixture(context);
  const manifestPath = resolve(manifestRoot, "spec/v1_product_artifact_manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.executionSpecId = "stale";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(generate(manifestRoot, "--check", "--source-only"), /source identity is stale/);
});

test("normal check refuses to pass when compiled artifacts are absent", async (context) => {
  const root = await fixture(context);
  await assert.rejects(generate(root, "--check"), /ENOENT/);
});
