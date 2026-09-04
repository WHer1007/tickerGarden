import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sourceRoots = [
  "contracts/src/v1",
  "contracts/test/v1",
  "services/backend-api/src",
  "services/indexer/src",
  "deployments/src",
  "services/maintenance-runner/src",
  "apps/web/src",
];

const requiredPaths = [
  "contracts/src/v1/shared/V1Scaffold.sol",
  "contracts/test/v1/V1Scaffold.t.sol",
  "services/backend-api/src/index.ts",
  "services/indexer/src/index.ts",
  "deployments/src/index.ts",
  "services/maintenance-runner/src/index.ts",
  "apps/web/src/app.ts",
];

const retiredPaths = [
  "contracts/src/EmissionController.sol",
  "contracts/src/RewardEscrow.sol",
  "contracts/src/StockStakingGauge.sol",
  "contracts/src/TickerMemeToken.sol",
  "contracts/src/OfficialStockRegistry.sol",
  "contracts/test/EmissionController.t.sol",
  "contracts/test/RewardEscrow.t.sol",
  "contracts/test/StockStakingGauge.t.sol",
  "contracts/test/TickerMemeToken.t.sol",
  "services/execution-worker",
  "spikes/v4-subscriber",
  "spec/reference_math.py",
  "spec/test_reference_math.py",
  "spec/contract_abi_surface.json",
  "spec/test_contract_abi_surface.py",
  "spec/permissions_matrix.json",
  "spec/test_permissions_matrix.py",
  "deployments/src/preflight.ts",
  "deployments/src/cli.ts",
  "deployments/manifests/robinhood-mainnet.draft.json",
  "deployments/schemas/environment-manifest-v0.1.schema.json",
  "website",
  ".codex_tmp/tickergarden_sim",
];

const forbiddenSymbols = [
  "EmissionController",
  "RewardEscrow",
  "StockStakingGauge",
  "executeStockBuyback",
  "executeTgardBuybackAndBurn",
  "STOCK_BUYBACK",
  "TGARD_BUYBACK",
  "Earn mStock",
  "block by block",
  "one canonical mStock",
  "InitialUsdc",
  "usdcAmountDesired",
];

const forbiddenProductionImports = ["spec/interfaces/IV1MutationSurfaceDraft.sol"];

const sourceExtensions = new Set([".sol", ".ts", ".tsx", ".js", ".jsx"]);
const ignoredDirectories = new Set(["node_modules", "dist", "out", "out-v1", "cache", "cache-v1"]);

async function exists(relativePath) {
  try {
    await stat(path.join(repositoryRoot, relativePath));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function collectSourceFiles(relativeRoot) {
  const absoluteRoot = path.join(repositoryRoot, relativeRoot);
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(relativePath)));
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }

  return files;
}

const failures = [];

for (const requiredPath of requiredPaths) {
  if (!(await exists(requiredPath))) failures.push(`missing required scaffold path: ${requiredPath}`);
}

for (const retiredPath of retiredPaths) {
  if (await exists(retiredPath)) failures.push(`retired Test Prototype path is present: ${retiredPath}`);
}

for (const sourceRoot of sourceRoots) {
  if (!(await exists(sourceRoot))) {
    failures.push(`missing source boundary: ${sourceRoot}`);
    continue;
  }

  for (const sourceFile of await collectSourceFiles(sourceRoot)) {
    const contents = await readFile(path.join(repositoryRoot, sourceFile), "utf8");
    if (sourceFile.startsWith("contracts/src/v1/")) {
      for (const forbiddenImport of forbiddenProductionImports) {
        if (contents.includes(forbiddenImport)) {
          failures.push(`${sourceFile}: imports specification draft \`${forbiddenImport}\``);
        }
      }
    }
    for (const symbol of forbiddenSymbols) {
      if (contents.includes(symbol)) failures.push(`${sourceFile}: forbidden Test Prototype symbol \`${symbol}\``);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`V1 boundary check failed:\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("V1 scaffold boundary verified: required paths exist and retired Test Prototype logic is absent.\n");
}
