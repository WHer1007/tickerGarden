import { appendFileSync, existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function filesBelow(relativeRoot, predicate) {
  const absoluteRoot = path.join(repositoryRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];
  const output = [];
  for (const entry of await readdir(absoluteRoot, { withFileTypes: true })) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) output.push(...(await filesBelow(relativePath, predicate)));
    if (entry.isFile() && predicate(relativePath)) output.push(relativePath);
  }
  return output.sort();
}

function failed(track, reason) {
  throw new Error(`V1 ${track} track FAILED: ${reason}`);
}

export function classifyProductTrack(inventory) {
  const { sources, tests, testFunctions, missingArtifacts } = inventory;
  if (sources === 0 && tests === 0) {
    return { track: "product", state: "NOT_STARTED", detail: "0 product modules; 0 product tests" };
  }
  if (sources === 0) failed("product", `${tests} product test file(s) exist without a product module`);
  if (tests === 0) failed("product", `${sources} product module(s) exist without a product test file`);
  if (testFunctions === 0) failed("product", "product test files contain no test or invariant functions");
  if (missingArtifacts.length > 0) {
    failed("product", `missing compiled artifacts for: ${missingArtifacts.join(", ")}`);
  }
  return {
    track: "product",
    state: "ACTIVE",
    detail: `${sources} product module(s); ${tests} test file(s); ${testFunctions} test/invariant function(s)`,
  };
}

export function classifyForkTrack(inventory) {
  const {
    tests,
    testFunctions,
    fixtureFiles,
    fixtureManifest,
    fixtureValidator,
    fixtureTests,
    fixtureTestFunctions,
    rpcConfigured,
  } = inventory;
  const fixtureLayerStarted = fixtureFiles > 0 || fixtureValidator || fixtureTests > 0;
  if (tests === 0 && !fixtureLayerStarted) {
    return { track: "fork", state: "NOT_STARTED", detail: "0 fork tests; 0 fork fixtures" };
  }
  if (!fixtureManifest) {
    failed("fork", "contracts/test/v1/fixtures/v1-fork-fixtures.json is required");
  }
  if (!fixtureValidator) failed("fork", "spec/generate_v1_test_fixtures.py is required");
  if (fixtureTests === 0) failed("fork", "fixture manifest exists without a local fixture test");
  if (fixtureTestFunctions === 0) failed("fork", "local fixture tests contain no test functions");
  if (tests === 0) {
    return {
      track: "fork",
      state: "FIXTURES_ACTIVE",
      detail: `${fixtureTests} local fixture test file(s); fixed fixture manifest and validator present; live fork tests not started`,
    };
  }
  if (testFunctions === 0) failed("fork", "fork test files contain no test functions");
  if (!rpcConfigured) failed("fork", "ROBINHOOD_RPC_URL is required after the fork track starts");
  return {
    track: "fork",
    state: "ACTIVE",
    detail: `${tests} fork test file(s); fixed fixture manifest present; RPC configured`,
  };
}

export function classifyDeploymentTrack(inventory) {
  const { schemas, schemaSources, schemaTests, preflightSources, preflightTests } = inventory;
  if (
    schemas === 0 &&
    schemaSources === 0 &&
    schemaTests === 0 &&
    preflightSources === 0 &&
    preflightTests === 0
  ) {
    return {
      track: "deployment",
      state: "NOT_STARTED",
      detail: "0 deployment schemas; no preflight implementation or tests",
    };
  }
  if (schemas === 0) failed("deployment", "deployment work exists without a deployment schema");
  if (schemaSources === 0) failed("deployment", "deployment schema exists without schema.ts");
  if (schemaTests === 0) failed("deployment", "deployment schema/validator exists without schema tests");
  if (preflightSources !== preflightTests) {
    failed("deployment", "preflight implementation and tests must be introduced together");
  }
  if (preflightSources === 0) {
    return {
      track: "deployment",
      state: "SCHEMA_ACTIVE",
      detail: `${schemas} schema(s); structural validator and tests present; live preflight not started`,
    };
  }
  return {
    track: "deployment",
    state: "ACTIVE",
    detail: `${schemas} schema(s); preflight implementation and tests present`,
  };
}

function forgeExecutable() {
  return [process.env.FOUNDRY_FORGE, "forge", path.join(homedir(), ".foundry", "bin", "forge")]
    .filter(Boolean)
    .find((candidate) => {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
      return result.status === 0;
    });
}

function runForgeTests(track, matchPath, forkUrl) {
  const executable = forgeExecutable();
  if (!executable) failed(track, "Foundry forge is unavailable");
  const args = ["test", "--match-path", matchPath];
  if (forkUrl) args.push("--fork-url", forkUrl);
  const result = spawnSync(executable, args, {
    cwd: path.join(repositoryRoot, "contracts"),
    env: { ...process.env, FOUNDRY_PROFILE: "v1" },
    stdio: "inherit",
  });
  if (result.status !== 0) failed(track, "Foundry tests failed");
}

function runFixtureValidator() {
  const result = spawnSync("python3", ["spec/generate_v1_test_fixtures.py", "--check"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) failed("fork", "fixed fixture manifest validation failed");
}

function runProductArtifactValidator() {
  const result = spawnSync("python3", ["spec/generate_v1_product_artifacts.py", "--check"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) failed("product", "compiled product artifact validation failed");
}

function runDeploymentChecks() {
  for (const args of [
    ["--prefix", "deployments", "run", "build"],
    ["--prefix", "deployments", "test"],
  ]) {
    const result = spawnSync("npm", args, { cwd: repositoryRoot, stdio: "inherit" });
    if (result.status !== 0) failed("deployment", `npm ${args.join(" ")} failed`);
  }
}

async function countTestFunctions(files) {
  let count = 0;
  for (const relativePath of files) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    count += (withoutComments.match(/\bfunction\s+(?:test|invariant_)[A-Za-z0-9_]*/g) ?? []).length;
  }
  return count;
}

async function hasCompiledArtifact(source) {
  const artifactDirectory = path.join(
    repositoryRoot,
    "contracts/out-v1",
    path.basename(source),
  );
  if (!existsSync(artifactDirectory)) return false;
  const contractSource = source.slice("contracts/".length);
  const artifactFiles = await filesBelow(
    path.relative(repositoryRoot, artifactDirectory),
    (file) => file.endsWith(".json"),
  );
  for (const artifactFile of artifactFiles) {
    const parsed = JSON.parse(await readFile(path.join(repositoryRoot, artifactFile), "utf8"));
    const metadata = parsed?.metadata;
    if (
      metadata?.sources?.[contractSource] &&
      Object.hasOwn(metadata?.settings?.compilationTarget ?? {}, contractSource)
    ) {
      return true;
    }
  }
  return false;
}

async function productStatus() {
  const sources = await filesBelow("contracts/src/v1/modules", (file) => file.endsWith(".sol"));
  const tests = await filesBelow("contracts/test/v1/product", (file) => file.endsWith(".t.sol"));
  const artifactChecks = await Promise.all(sources.map(hasCompiledArtifact));
  const missingArtifacts = sources.filter((_, index) => !artifactChecks[index]);
  const status = classifyProductTrack({
    sources: sources.length,
    tests: tests.length,
    testFunctions: await countTestFunctions(tests),
    missingArtifacts,
  });
  if (status.state === "ACTIVE") {
    runForgeTests("product", "test/v1/product/**/*.t.sol");
    runProductArtifactValidator();
  }
  return status;
}

async function forkStatus() {
  const tests = await filesBelow("contracts/test/v1/fork", (file) => file.endsWith(".t.sol"));
  const fixtureTests = await filesBelow(
    "contracts/test/v1/fixtures",
    (file) => file.endsWith(".t.sol"),
  );
  const fixtures = await filesBelow(
    "contracts/test/v1/fixtures",
    (file) => /\.(?:json|toml)$/.test(file),
  );
  const fixtureManifest = fixtures.includes(
    "contracts/test/v1/fixtures/v1-fork-fixtures.json",
  );
  const rpcUrl = process.env.ROBINHOOD_RPC_URL?.trim() ?? "";
  const status = classifyForkTrack({
    tests: tests.length,
    testFunctions: await countTestFunctions(tests),
    fixtureFiles: fixtures.length,
    fixtureManifest,
    fixtureValidator: existsSync(path.join(repositoryRoot, "spec/generate_v1_test_fixtures.py")),
    fixtureTests: fixtureTests.length,
    fixtureTestFunctions: await countTestFunctions(fixtureTests),
    rpcConfigured: rpcUrl.length > 0,
  });
  if (status.state === "FIXTURES_ACTIVE" || status.state === "ACTIVE") {
    runForgeTests("fork", "test/v1/fixtures/**/*.t.sol");
    runFixtureValidator();
  }
  if (status.state === "ACTIVE") runForgeTests("fork", "test/v1/fork/**/*.t.sol", rpcUrl);
  return status;
}

async function deploymentStatus() {
  const schemas = await filesBelow(
    "deployments/schemas",
    (file) => file.endsWith(".schema.json"),
  );
  const status = classifyDeploymentTrack({
    schemas: schemas.length,
    schemaSources: existsSync(path.join(repositoryRoot, "deployments/src/schema.ts")) ? 1 : 0,
    schemaTests: existsSync(path.join(repositoryRoot, "deployments/test/schema.test.ts")) ? 1 : 0,
    preflightSources: existsSync(path.join(repositoryRoot, "deployments/src/v1/preflight.ts")) ? 1 : 0,
    preflightTests: existsSync(path.join(repositoryRoot, "deployments/test/preflight.test.ts")) ? 1 : 0,
  });
  if (status.state === "ACTIVE" || status.state === "SCHEMA_ACTIVE") runDeploymentChecks();
  return status;
}

function publish(statuses) {
  const lines = statuses.map(
    ({ track, state, detail }) => `V1 ${track} track: ${state} (${detail})`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## V1 implementation tracks\n\n${statuses
        .map(({ track, state, detail }) => `- **${track}**: \`${state}\` — ${detail}`)
        .join("\n")}\n`,
    );
  }
}

async function main() {
  const option = process.argv[2] ?? "all";
  const runners = { product: productStatus, fork: forkStatus, deployment: deploymentStatus };
  if (option === "all") {
    publish(await Promise.all(Object.values(runners).map((runner) => runner())));
    return;
  }
  if (!(option in runners)) failed("selection", `unknown track: ${option}`);
  publish([await runners[option]()]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
